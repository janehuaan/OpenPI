use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use serde_json::Value;
use openpi_proto::{SessionInfo, SessionMode};
use openpi_engine::config::{default_project_workspace, is_forbidden_workspace_dir};

pub fn openpi_dir() -> PathBuf {
    if let Ok(p) = std::env::var("OPENPI_DIR") {
        PathBuf::from(p)
    } else {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".openpi")
    }
}

pub fn instances_path() -> PathBuf {
    openpi_dir().join("instances.json")
}

pub fn sessions_dir() -> PathBuf {
    openpi_dir().join("sessions")
}

pub fn find_session_file(sid: &str) -> PathBuf {
    let direct = sessions_dir().join(format!("{}.jsonl", sid));
    if direct.exists() {
        return direct;
    }
    let agent_sessions = openpi_dir().join("agent").join("sessions");
    if agent_sessions.exists() {
        if let Ok(entries) = std::fs::read_dir(&agent_sessions) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    if let Ok(files) = std::fs::read_dir(&p) {
                        for f in files.flatten() {
                            let fp = f.path();
                            if let Some(name) = fp.file_name().and_then(|n| n.to_str()) {
                                if name.contains(sid) && name.ends_with(".jsonl") {
                                    return fp;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    direct
}

type PendingMap =
    Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<Value, String>>>>>;

pub struct ManagedSession {
    pub info: SessionInfo,
    pub pending: PendingMap,
}

#[derive(Clone)]
pub struct Supervisor {
    sessions: Arc<Mutex<HashMap<String, ManagedSession>>>,
    pub event_tx: broadcast::Sender<(String, Value)>,
    pub jev: Arc<openpi_jev::JevCoordinator>,
    pub memory: Arc<openpi_memory::CodebaseMemoryManager>,
    pub pi_cli_path: Arc<tokio::sync::RwLock<String>>,
    pub engine: Arc<openpi_engine::EngineSessionManager>,
}

impl Supervisor {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(16384);
        let mut map = HashMap::new();
        let path = instances_path();
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(records) = serde_json::from_str::<Vec<SessionInfo>>(&content) {
                    for mut r in records {
                        if r.in_memory == Some(true) {
                            continue;
                        }
                        r.running = false;
                        map.insert(
                            r.session_id.clone(),
                            ManagedSession {
                                info: r,
                                pending: Arc::new(Mutex::new(HashMap::new())),
                            },
                        );
                    }
                }
            }
        }

        // Auto-discover session files in ~/.openpi/sessions and ~/.openpi/agent/sessions/**
        let scan_dirs = vec![
            sessions_dir(),
            openpi_dir().join("agent").join("sessions"),
        ];
        for base_dir in scan_dirs {
            if !base_dir.exists() {
                continue;
            }
            let mut stack = vec![base_dir];
            while let Some(dir) = stack.pop() {
                if let Ok(entries) = std::fs::read_dir(&dir) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() {
                            stack.push(p);
                        } else if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                            if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                                let sid = if let Some((_, uuid_part)) = stem.split_once('_') {
                                    uuid_part.to_string()
                                } else {
                                    stem.to_string()
                                };
                                if !map.contains_key(&sid) {
                                    if let Some(info) = Self::inspect_session_file(&p, &sid) {
                                        map.insert(
                                            sid.clone(),
                                            ManagedSession {
                                                info,
                                                pending: Arc::new(Mutex::new(HashMap::new())),
                                            },
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Auto-summarize any session that has no name or has generic "新对话"
        for (sid, sess) in map.iter_mut() {
            let needs_name = sess.info.name.is_none()
                || sess.info.name.as_deref().unwrap_or("").trim().is_empty()
                || sess.info.name.as_deref() == Some("新对话");
            if needs_name {
                let file_path = find_session_file(sid);
                if let Some(derived) = openpi_engine::title_summarizer::extract_title_from_jsonl(&file_path, &sess.info.cwd) {
                    sess.info.name = Some(derived);
                }
            }
        }

        let jev = Arc::new(openpi_jev::JevCoordinator::new());
        jev.spawn_async_warmup();
        let memory = Arc::new(openpi_memory::CodebaseMemoryManager::new());
        let pi_cli_path = Arc::new(tokio::sync::RwLock::new(String::new()));

        let engine_cfg = openpi_engine::EngineConfig::load().unwrap_or_else(|_| openpi_engine::EngineConfig {
            default_provider: None,
            default_model: None,
            max_steps: 200,
            models: HashMap::new(),
            providers: HashMap::new(),
        });
        let tool_reg = openpi_engine::ToolRegistry::new(jev.clone(), memory.clone());
        let engine = Arc::new(openpi_engine::EngineSessionManager::new(
            engine_cfg,
            tool_reg,
            event_tx.clone(),
        ));

        let supervisor = Self {
            sessions: Arc::new(Mutex::new(map)),
            event_tx,
            jev,
            memory,
            pi_cli_path,
            engine,
        };

        // Save consolidated records in background
        let s_clone = supervisor.clone();
        tokio::spawn(async move {
            s_clone.save_records().await;
        });

        // 自动触发：守护进程启动时在后台静默做梦，初始化自适应探索参数
        let jev_init = supervisor.jev.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            let dir = sessions_dir();
            if let Ok(res) = jev_init.trigger_offline_dreaming(&dir).await {
                tracing::info!("🌌 [Jev Dream-RSI] 启动自适应做梦完成: beta*={:?}", res.get("optimal_beta"));
            }
        });

        // 监听会话重命名事件并实时持久化 records
        let sup_rename = supervisor.clone();
        let mut rename_rx = supervisor.subscribe_events();
        tokio::spawn(async move {
            while let Ok((sid, val)) = rename_rx.recv().await {
                if val.get("type").and_then(|v| v.as_str()) == Some("session_renamed") {
                    if let Some(new_name) = val.get("name").and_then(|v| v.as_str()) {
                        let _ = sup_rename.rename_session(&sid, Some(new_name.to_string())).await;
                    }
                }
            }
        });

        supervisor
    }

    fn inspect_session_file(path: &Path, session_id: &str) -> Option<SessionInfo> {
        let file = std::fs::File::open(path).ok()?;
        use std::io::{BufRead, BufReader as StdBufReader};
        let reader = StdBufReader::new(file);

        let mut cwd = String::new();
        let mut name: Option<String> = None;
        let mut created_at = chrono::Utc::now().to_rfc3339();
        let mut model: Option<String> = None;

        if let Ok(meta) = std::fs::metadata(path) {
            if let Ok(mtime) = meta.modified() {
                let dt: chrono::DateTime<chrono::Utc> = mtime.into();
                created_at = dt.to_rfc3339();
            }
        }

        for (idx, line) in reader.lines().enumerate() {
            if idx > 80 {
                break;
            }
            if let Ok(l) = line {
                if l.trim().is_empty() {
                    continue;
                }
                if let Ok(val) = serde_json::from_str::<Value>(&l) {
                    if val.get("type").and_then(|v| v.as_str()) == Some("session") {
                        if let Some(c) = val.get("cwd").and_then(|v| v.as_str()) {
                            cwd = c.to_string();
                        }
                        if let Some(ts) = val.get("timestamp").and_then(|v| v.as_str()) {
                            created_at = ts.to_string();
                        }
                    } else if val.get("type").and_then(|v| v.as_str()) == Some("session_info") {
                        if let Some(n) = val.get("name").and_then(|v| v.as_str()) {
                            if !n.is_empty() {
                                name = Some(n.to_string());
                            }
                        }
                    } else if val.get("type").and_then(|v| v.as_str()) == Some("model_change") {
                        if let Some(mid) = val.get("modelId").and_then(|v| v.as_str()) {
                            model = Some(mid.to_string());
                        }
                    } else if val.get("type").and_then(|v| v.as_str()) == Some("message") && name.is_none() {
                        if let Some(msg) = val.get("message") {
                            if msg.get("role").and_then(|v| v.as_str()) == Some("user") {
                                if let Some(contents) = msg.get("content").and_then(|v| v.as_array()) {
                                    for c in contents {
                                        if c.get("type").and_then(|v| v.as_str()) == Some("text") {
                                            if let Some(txt) = c.get("text").and_then(|v| v.as_str()) {
                                                let t = openpi_engine::title_summarizer::summarize_title_heuristic(txt, &cwd);
                                                if !t.is_empty() && t != "新对话" {
                                                    name = Some(t);
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if cwd.is_empty() || is_forbidden_workspace_dir(Path::new(&cwd)).is_err() {
            cwd = default_project_workspace().to_string_lossy().to_string();
        }

        Some(SessionInfo {
            session_id: session_id.to_string(),
            cwd,
            mode: SessionMode::Code,
            name,
            model,
            in_memory: Some(false),
            running: false,
            created_at: created_at.clone(),
            updated_at: created_at,
        })
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<(String, Value)> {
        self.event_tx.subscribe()
    }

    pub async fn save_records(&self) {
        let path = instances_path();
        let _ = std::fs::create_dir_all(openpi_dir());
        let sessions = self.sessions.lock().await;
        let mut records: Vec<SessionInfo> = Vec::with_capacity(sessions.len());
        for s in sessions.values() {
            let mut info = s.info.clone();
            info.running = self.engine.is_running(&info.session_id).await;
            records.push(info);
        }
        records.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        if let Ok(json) = serde_json::to_string_pretty(&records) {
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, &path);
            }
        }
    }

    pub async fn list_sessions(&self) -> Vec<SessionInfo> {
        let sessions = self.sessions.lock().await;
        let mut list: Vec<SessionInfo> = Vec::with_capacity(sessions.len());
        for s in sessions.values() {
            let mut info = s.info.clone();
            info.running = self.engine.is_running(&info.session_id).await;
            list.push(info);
        }
        list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        list
    }

    pub async fn get_session(&self, id: &str) -> Option<SessionInfo> {
        let sessions = self.sessions.lock().await;
        if let Some(s) = sessions.get(id) {
            let mut info = s.info.clone();
            info.running = self.engine.is_running(&info.session_id).await;
            Some(info)
        } else {
            None
        }
    }

    pub async fn set_pi_cli_path(&self, path: &str) {
        let mut p = self.pi_cli_path.write().await;
        *p = path.to_string();
    }

    pub async fn get_pi_cli_path(&self) -> String {
        self.pi_cli_path.read().await.clone()
    }

    pub fn reload_engine_config(&self) -> anyhow::Result<()> {
        self.engine.reload_config()
    }

    pub async fn run_ephemeral_subagent(
        &self,
        goal: &str,
        role: &str,
        cwd: &str,
        timeout_secs: u64,
    ) -> anyhow::Result<String> {
        let subagent_id = format!("subagent-{}", uuid::Uuid::new_v4());
        let mode = SessionMode::Code;
        let pi_cli = self.get_pi_cli_path().await;

        // 1. Create in-memory ephemeral session (no disk session files)
        let _info = self.create_session(
            subagent_id.clone(),
            cwd.to_string(),
            mode,
            None,
            Some(format!("Subagent: {}", role)),
            Some(true),
        ).await?;

        // 2. Ensure process runs
        if let Err(e) = self.ensure_process(&subagent_id, &pi_cli).await {
            let _ = self.delete_session(&subagent_id).await;
            anyhow::bail!("Failed to spawn subagent process: {}", e);
        }

        // 3. Prepare high-density directive
        let prompt_text = format!(
            "【Ephemeral Subagent Directive】\nRole: {}\nObjective: {}\n\n\
             Instructions:\n\
             - Investigate and execute tools (read, grep, find, code_search, repo_map) to thoroughly fulfill the objective.\n\
             - Conclude with a clear, high-density Markdown summary (under 400 words) containing exact file paths, line ranges, and findings.\n\
             - Be factual, concise, and structured.",
            role, goal
        );

        let rpc_cmd = serde_json::json!({
            "type": "prompt",
            "message": prompt_text
        });

        // 4. Subscribe to events
        let mut rx = self.subscribe_events();
        let target_sid = subagent_id.clone();

        let s_clone = self.clone();
        let sid_for_send = subagent_id.clone();
        tokio::spawn(async move {
            let _ = s_clone.send_rpc(&sid_for_send, &rpc_cmd).await;
        });

        // 5. Await finish or timeout
        let start = std::time::Instant::now();
        let max_duration = std::time::Duration::from_secs(timeout_secs.max(10));
        let mut final_text = String::new();

        while start.elapsed() < max_duration {
            match tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await {
                Ok(Ok((sid, ev))) => {
                    if sid == target_sid {
                        let ev_type = ev.get("type").and_then(|v| v.as_str()).unwrap_or("");
                        if ev_type == "message_end" || ev_type == "message" || ev_type == "message_update" {
                            if let Some(msg) = ev.get("message") {
                                if let Some(c) = msg.get("content") {
                                    if let Some(text) = c.as_str() {
                                        if !text.trim().is_empty() {
                                            final_text = text.to_string();
                                        }
                                    } else if let Some(arr) = c.as_array() {
                                        let mut combined = String::new();
                                        for part in arr {
                                            if let Some(t) = part.get("text").and_then(|v| v.as_str()) {
                                                combined.push_str(t);
                                            }
                                        }
                                        if !combined.trim().is_empty() {
                                            final_text = combined;
                                        }
                                    }
                                }
                            } else if let Some(text) = ev.get("content").and_then(|c| c.as_str()) {
                                if !text.trim().is_empty() {
                                    final_text = text.to_string();
                                }
                            }
                        } else if (ev_type == "agent_end" || ev_type == "turn_end") && !final_text.trim().is_empty() {
                            break;
                        }
                    }
                }
                _ => {
                    let is_running = {
                        let sessions = self.sessions.lock().await;
                        sessions.get(&target_sid).map(|s| s.info.running).unwrap_or(false)
                    };
                    if !is_running && !final_text.is_empty() {
                        break;
                    }
                }
            }
        }

        if final_text.trim().is_empty() {
            if let Ok(res) = self.send_rpc(&subagent_id, &serde_json::json!({ "type": "get_last_assistant_text" })).await {
                if let Some(t) = res.get("text").and_then(|v| v.as_str()) {
                    final_text = t.to_string();
                }
            }
        }

        // 6. Tear down ephemeral session cleanly
        let _ = self.stop_session(&subagent_id).await;
        let _ = self.delete_session(&subagent_id).await;

        if final_text.trim().is_empty() {
            final_text = format!("### 🤖 [Ephemeral Subagent: {}]\n**Goal**: {}\n\nSubagent completed investigation.", role, goal);
        }

        Ok(final_text)
    }

    pub async fn create_session(
        &self,
        id: String,
        cwd: String,
        mode: SessionMode,
        model: Option<String>,
        name: Option<String>,
        in_memory: Option<bool>,
    ) -> anyhow::Result<SessionInfo> {
        let now = chrono::Utc::now().to_rfc3339();
        let safe_cwd = if cwd.is_empty() || is_forbidden_workspace_dir(Path::new(&cwd)).is_err() {
            default_project_workspace().to_string_lossy().to_string()
        } else {
            cwd.clone()
        };
        let info = SessionInfo {
            session_id: id.clone(),
            cwd: safe_cwd,
            mode,
            name,
            model,
            in_memory,
            running: false,
            created_at: now.clone(),
            updated_at: now,
        };

        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(
                id.clone(),
                ManagedSession {
                    info: info.clone(),
                    pending: Arc::new(Mutex::new(HashMap::new())),
                },
            );
        }

        self.save_records().await;
        Ok(info)
    }

    pub async fn delete_session(&self, id: &str) -> anyhow::Result<()> {
        let _ = self.stop_session(id).await;
        {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(id);
        }
        self.save_records().await;
        Ok(())
    }

    pub async fn rename_session(&self, id: &str, name: Option<String>) -> anyhow::Result<()> {
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(s) = sessions.get_mut(id) {
                s.info.name = name;
                s.info.updated_at = chrono::Utc::now().to_rfc3339();
            }
        }
        self.save_records().await;
        Ok(())
    }

    pub async fn update_session_workspace(&self, id: &str, cwd: String) -> anyhow::Result<()> {
        if let Err(err_msg) = is_forbidden_workspace_dir(Path::new(&cwd)) {
            anyhow::bail!("拒绝将工作区变更为非法或敏感目录: {}", err_msg);
        }
        let _ = self.stop_session(id).await;
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(s) = sessions.get_mut(id) {
                s.info.cwd = cwd;
                s.info.updated_at = chrono::Utc::now().to_rfc3339();
            }
        }
        self.save_records().await;
        Ok(())
    }

    pub async fn update_session_model(&self, id: &str, model: String) -> anyhow::Result<()> {
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(s) = sessions.get_mut(id) {
                s.info.model = Some(model);
                s.info.updated_at = chrono::Utc::now().to_rfc3339();
            }
        }
        self.save_records().await;
        Ok(())
    }

    pub async fn is_session_running(&self, session_id: &str) -> bool {
        self.engine.is_running(session_id).await
    }

    pub async fn ensure_process(
        &self,
        session_id: &str,
        _pi_cli_path: &str,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().await;
        if !sessions.contains_key(session_id) {
            let session_file = find_session_file(session_id);
            let info = if session_file.exists() {
                Self::inspect_session_file(&session_file, session_id).unwrap_or_else(|| {
                    let now = chrono::Utc::now().to_rfc3339();
                    SessionInfo {
                        session_id: session_id.to_string(),
                        cwd: default_project_workspace().to_string_lossy().to_string(),
                        mode: SessionMode::Code,
                        name: None,
                        model: None,
                        in_memory: None,
                        running: false,
                        created_at: now.clone(),
                        updated_at: now,
                    }
                })
            } else {
                let now = chrono::Utc::now().to_rfc3339();
                SessionInfo {
                    session_id: session_id.to_string(),
                    cwd: default_project_workspace().to_string_lossy().to_string(),
                    mode: SessionMode::Code,
                    name: None,
                    model: None,
                    in_memory: None,
                    running: false,
                    created_at: now.clone(),
                    updated_at: now,
                }
            };
            sessions.insert(
                session_id.to_string(),
                ManagedSession {
                    info,
                    pending: Arc::new(Mutex::new(HashMap::new())),
                },
            );
        }

        let _ = self.event_tx.send((session_id.to_string(), serde_json::json!({ "type": "rpc_ready" })));
        Ok(())
    }

    pub async fn send_rpc(&self, session_id: &str, command: &Value) -> anyhow::Result<Value> {
        let cmd_type = command.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match cmd_type {
            "prompt" => {
                let msg = command.get("message").and_then(|v| v.as_str()).unwrap_or("");
                let cwd = {
                    let sessions = self.sessions.lock().await;
                    sessions.get(session_id).map(|s| s.info.cwd.clone()).unwrap_or_else(|| ".".into())
                };
                let model_override = {
                    let sessions = self.sessions.lock().await;
                    sessions.get(session_id).and_then(|s| s.info.model.clone())
                };

                let needs_name = {
                    let sessions = self.sessions.lock().await;
                    sessions.get(session_id).map(|s| {
                        s.info.name.is_none()
                            || s.info.name.as_deref().unwrap_or("").trim().is_empty()
                            || s.info.name.as_deref() == Some("新对话")
                    }).unwrap_or(false)
                };
                if needs_name && !msg.trim().is_empty() {
                    let fast_title = openpi_engine::title_summarizer::summarize_title_heuristic(msg, &cwd);
                    if !fast_title.is_empty() && fast_title != "新对话" {
                        let _ = self.rename_session(session_id, Some(fast_title.clone())).await;
                        let _ = self.event_tx.send((session_id.to_string(), serde_json::json!({
                            "type": "session_renamed",
                            "sessionId": session_id,
                            "name": fast_title,
                        })));
                    }
                }

                self.engine.prompt(session_id, msg, &cwd, model_override.as_deref()).await?;
                Ok(serde_json::json!(true))
            }
            "abort" => {
                self.engine.abort(session_id).await?;
                Ok(serde_json::json!(true))
            }
            "set_model" => {
                if let Some(m) = command.get("modelId").and_then(|v| v.as_str()) {
                    let prov = command.get("provider").and_then(|v| v.as_str()).unwrap_or("");
                    let name = command.get("name").and_then(|v| v.as_str()).unwrap_or(m);
                    let model_str = if prov.is_empty() { m.to_string() } else { format!("{}/{}", prov, m) };
                    self.engine.set_model(session_id, prov, m, name).await;
                    let _ = self.update_session_model(session_id, model_str).await;

                    return Ok(serde_json::json!({
                        "model": {
                            "id": m,
                            "name": name,
                            "provider": prov
                        },
                        "sessionId": session_id,
                        "isStreaming": false,
                        "isCompacting": false
                    }));
                }
                Ok(serde_json::json!(true))
            }
            "set_thinking_level" => {
                let level = command.get("level").and_then(|v| v.as_str()).unwrap_or("medium");
                let mut journal = openpi_engine::session_journal::SessionJournal::open(session_id);
                let _ = journal.append_thinking_level_change(level);
                Ok(serde_json::json!({
                    "thinkingLevel": level,
                    "sessionId": session_id
                }))
            }
            "steer" => {
                let msg = command.get("message").and_then(|v| v.as_str()).unwrap_or("");
                let cwd = {
                    let sessions = self.sessions.lock().await;
                    sessions.get(session_id).map(|s| s.info.cwd.clone()).unwrap_or_else(|| ".".into())
                };
                let model_override = {
                    let sessions = self.sessions.lock().await;
                    sessions.get(session_id).and_then(|s| s.info.model.clone())
                };
                let _ = self.engine.abort(session_id).await;
                self.engine.prompt(session_id, msg, &cwd, model_override.as_deref()).await?;
                Ok(serde_json::json!(true))
            }
            "get_commands" => {
                Ok(serde_json::json!({ "commands": ["/help", "/compact", "/reset", "/model"] }))
            }
            "extension_ui_response" => {
                Ok(serde_json::json!(true))
            }
            _ => {
                Ok(serde_json::json!(true))
            }
        }
    }

    pub async fn stop_session(&self, session_id: &str) -> anyhow::Result<()> {
        let _ = self.engine.abort(session_id).await;
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.info.running = false;
            let mut p = session.pending.lock().await;
            for (_, tx) in p.drain() {
                let _ = tx.send(Err("Session stopped".into()));
            }
        }
        Ok(())
    }

    pub async fn shutdown_all(&self) {
        let mut sessions = self.sessions.lock().await;
        for (sid, session) in sessions.iter_mut() {
            let _ = self.engine.abort(sid).await;
            session.info.running = false;
            let mut p = session.pending.lock().await;
            for (_, tx) in p.drain() {
                let _ = tx.send(Err("Daemon shutting down".into()));
            }
        }
        tracing::info!("All managed sessions stopped.");
    }
}

impl Default for Supervisor {
    fn default() -> Self {
        Self::new()
    }
}
