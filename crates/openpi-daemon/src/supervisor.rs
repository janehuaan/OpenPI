use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, Mutex};
use tracing::{info, warn};
use serde_json::Value;
use openpi_proto::{SessionInfo, SessionMode};

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

pub fn resolve_node_executable() -> (PathBuf, bool) {
    if let Ok(p) = std::env::var("OPENPI_NODE_PATH") {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            let is_electron = p.to_lowercase().contains("openpi") || p.to_lowercase().contains("electron");
            return (pb, is_electron);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            if let Some(res) = parent.parent() {
                if let Some(contents) = res.parent() {
                    let macos_openpi = contents.join("MacOS").join("OpenPI");
                    if macos_openpi.exists() {
                        return (macos_openpi, true);
                    }
                }
            }
        }
    }

    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        PathBuf::from("/Applications/OpenPI.app/Contents/MacOS/OpenPI"),
        PathBuf::from(format!("{}/.local/bin/node", home)),
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
    ];

    for c in &candidates {
        if c.exists() {
            let is_electron = c.to_string_lossy().to_lowercase().contains("openpi")
                || c.to_string_lossy().to_lowercase().contains("electron");
            return (c.clone(), is_electron);
        }
    }

    (PathBuf::from("node"), false)
}

pub fn resolve_pi_rpc_entry(pi_cli_path: &str) -> PathBuf {
    if let Ok(p) = std::env::var("OPENPI_PI_RPC_ENTRY") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return pb;
        }
    }

    let cli = PathBuf::from(pi_cli_path);
    if cli.exists() {
        if cli.to_string_lossy().ends_with("rpc-entry.js") {
            return cli;
        }
        if let Some(parent) = cli.parent() {
            let bundle = parent.join("bundle").join("rpc-entry.js");
            if bundle.exists() {
                return bundle;
            }
            let rpc = parent.join("rpc-entry.js");
            if rpc.exists() {
                return rpc;
            }
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundle = dir.join("node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js");
            if bundle.exists() {
                return bundle;
            }
            let rpc = dir.join("node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js");
            if rpc.exists() {
                return rpc;
            }
        }
    }

    let user_runtime = openpi_dir().join("runtime/node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js");
    if user_runtime.exists() {
        return user_runtime;
    }

    cli
}

const CODE_MODE_UNATTENDED_DIRECTIVE: &str = "\
【OpenPI 无人值守自主研发与持续自愈准则】：\n\
1. 主动全维问题探测：在任何代码修改或开发任务完成后，必须主动调用 bash 运行项目对应的全维验证（包含编译/类型检查如 tsc / npm run typecheck、单元测试如 npm test / pytest / cargo test / go test、静态检查 lint 与构建 build）。\n\
2. 循环攻坚与自动收敛：如果在验证过程中发现任何测试失败、类型报错、编译错误或代码规范问题，严禁停滞或把半成品交付给用户，必须主动定位源码根因并实施修复，持续循环验证，直到所有维度达到 0 报错（完全通过）为止。\n\
3. 交付完整性：确保所有变更都经过真实验证，无破坏性副作用与遗留缺陷。\n\
4. 长耗时任务排重与幂等保护：执行可能超过 60 秒的长耗时重型任务（如 docker build、大型全量编译、镜像压包等）时，严禁盲目频繁重试！重新执行前必须先用 pgrep/docker ps 确认是否有前序同名任务正在运行，避免多进程重复竞争与死锁。\n\
5. 错误颠簸防死锁：若同一命令连续 2 次报完全相同的系统级环境错误（如 command not found / permission denied），严禁在错误原地反复空转，必须优先检查工具链 PATH 与执行环境并调整策略。";

pub struct ManagedSession {
    pub info: SessionInfo,
    pub child_stdin: Option<ChildStdin>,
    pub child: Option<Child>,
    pub pending: Arc<Mutex<HashMap<String, tokio::sync::oneshot::Sender<Result<Value, String>>>>>,
}

#[derive(Clone)]
pub struct Supervisor {
    sessions: Arc<Mutex<HashMap<String, ManagedSession>>>,
    event_tx: broadcast::Sender<(String, Value)>,
}

impl Supervisor {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(1024);
        let mut map = HashMap::new();
        let path = instances_path();
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(records) = serde_json::from_str::<Vec<SessionInfo>>(&content) {
                    for mut r in records {
                        r.running = false;
                        map.insert(
                            r.session_id.clone(),
                            ManagedSession {
                                info: r,
                                child_stdin: None,
                                child: None,
                                pending: Arc::new(Mutex::new(HashMap::new())),
                            },
                        );
                    }
                }
            }
        }

        // Auto-discover any session files in ~/.openpi/sessions/*.jsonl that are not in instances.json
        let s_dir = sessions_dir();
        if s_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&s_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                        if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                            let sid = stem.to_string();
                            if !map.contains_key(&sid) {
                                if let Some(info) = Self::inspect_session_file(&p, &sid) {
                                    map.insert(
                                        sid.clone(),
                                        ManagedSession {
                                            info,
                                            child_stdin: None,
                                            child: None,
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

        let supervisor = Self {
            sessions: Arc::new(Mutex::new(map)),
            event_tx,
        };

        // Save consolidated records in background
        let s_clone = supervisor.clone();
        tokio::spawn(async move {
            s_clone.save_records().await;
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
                                                let preview: String = txt.chars().take(40).collect();
                                                name = Some(preview);
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

        if cwd.is_empty() {
            cwd = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        }

        Some(SessionInfo {
            session_id: session_id.to_string(),
            cwd,
            mode: SessionMode::Code,
            name,
            model,
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
        let mut records: Vec<SessionInfo> = sessions.values().map(|s| s.info.clone()).collect();
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
        let mut list: Vec<SessionInfo> = sessions.values().map(|s| s.info.clone()).collect();
        list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        list
    }

    pub async fn get_session(&self, id: &str) -> Option<SessionInfo> {
        let sessions = self.sessions.lock().await;
        sessions.get(id).map(|s| s.info.clone())
    }

    pub async fn create_session(
        &self,
        id: String,
        cwd: String,
        mode: SessionMode,
        model: Option<String>,
        name: Option<String>,
    ) -> anyhow::Result<SessionInfo> {
        let now = chrono::Utc::now().to_rfc3339();
        let info = SessionInfo {
            session_id: id.clone(),
            cwd: cwd.clone(),
            mode,
            name,
            model,
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
                    child_stdin: None,
                    child: None,
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

    pub async fn ensure_process(
        &self,
        session_id: &str,
        pi_cli_path: &str,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().await;
        let session = match sessions.get_mut(session_id) {
            Some(s) => s,
            None => anyhow::bail!("Session not found: {}", session_id),
        };

        if session.child.is_some() {
            return Ok(());
        }

        let (node_bin, is_electron) = resolve_node_executable();
        let rpc_entry = resolve_pi_rpc_entry(pi_cli_path);
        let session_file = sessions_dir().join(format!("{}.jsonl", session_id));

        let _ = std::fs::create_dir_all(sessions_dir());
        let _ = std::fs::create_dir_all(openpi_dir().join("agent"));

        info!(
            "Spawning pi subprocess for session {}: node={:?} entry={:?}",
            session_id, node_bin, rpc_entry
        );

        let mut cmd = Command::new(&node_bin);

        #[cfg(target_os = "macos")]
        {
            cmd.arg("--import")
                .arg("data:text/javascript,Object.defineProperty(process,'title',{get:()=>'openpi',set:()=>{},configurable:true});");
        }

        cmd.arg(&rpc_entry)
            .arg("--mode")
            .arg("rpc")
            .arg("--session")
            .arg(&session_file);

        if let Some(m) = &session.info.model {
            cmd.arg("--model").arg(m);
        }

        if session.info.mode == SessionMode::Code {
            cmd.arg("--tools")
                .arg("read,bash,edit,write,grep,find,ls")
                .arg("--append-system-prompt")
                .arg(CODE_MODE_UNATTENDED_DIRECTIVE);
        }

        if is_electron {
            cmd.env("ELECTRON_RUN_AS_NODE", "1");
        }

        let default_path = format!(
            "{}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:{}",
            std::env::var("HOME").unwrap_or_default(),
            std::env::var("PATH").unwrap_or_default()
        );
        cmd.env("PATH", default_path);
        cmd.env("PI_CODING_AGENT_DIR", openpi_dir().join("agent"));
        cmd.env("PI_CODING_AGENT_SESSION_DIR", sessions_dir());

        let cwd_path = PathBuf::from(&session.info.cwd);
        let actual_cwd = if cwd_path.exists() {
            cwd_path
        } else {
            openpi_dir()
        };

        cmd.current_dir(&actual_cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().expect("child stdin piped");
        let stdout = child.stdout.take().expect("child stdout piped");

        session.child_stdin = Some(stdin);
        session.child = Some(child);
        session.info.running = true;

        let tx = self.event_tx.clone();
        let sid = session_id.to_string();
        let pending = session.pending.clone();

        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(&line) {
                    Ok(event) => {
                        if event.get("type").and_then(|v| v.as_str()) == Some("response") {
                            if let Some(req_id) = event.get("id").and_then(|v| v.as_str()) {
                                let mut p = pending.lock().await;
                                if let Some(sender) = p.remove(req_id) {
                                    let success = event.get("success").and_then(|v| v.as_bool()).unwrap_or(true);
                                    if success {
                                        let data = event.get("data").cloned().unwrap_or(Value::Null);
                                        let _ = sender.send(Ok(data));
                                    } else {
                                        let err = event.get("error").and_then(|v| v.as_str()).unwrap_or("RPC command failed").to_string();
                                        let _ = sender.send(Err(err));
                                    }
                                    continue;
                                }
                            }
                        }
                        let _ = tx.send((sid.clone(), event));
                    }
                    Err(e) => {
                        warn!("Failed to parse line from pi session {}: {}", sid, e);
                    }
                }
            }
            info!("Subprocess stdout stream ended for session {}", sid);
        });

        Ok(())
    }

    pub async fn send_rpc(&self, session_id: &str, command: &Value) -> anyhow::Result<Value> {
        let (rx, cmd_line) = {
            let mut sessions = self.sessions.lock().await;
            let session = match sessions.get_mut(session_id) {
                Some(s) => s,
                None => anyhow::bail!("Session not found: {}", session_id),
            };

            let stdin = match &mut session.child_stdin {
                Some(s) => s,
                None => anyhow::bail!("Session {} has no running process", session_id),
            };

            let mut cmd = command.clone();
            let req_id = match cmd.get("id").and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => {
                    let new_id = uuid::Uuid::new_v4().to_string();
                    if let Some(obj) = cmd.as_object_mut() {
                        obj.insert("id".to_string(), Value::String(new_id.clone()));
                    }
                    new_id
                }
            };

            let (tx, rx) = tokio::sync::oneshot::channel();
            {
                let mut p = session.pending.lock().await;
                p.insert(req_id, tx);
            }

            let mut line = serde_json::to_string(&cmd)?;
            line.push('\n');
            stdin.write_all(line.as_bytes()).await?;
            stdin.flush().await?;

            (rx, line)
        };

        let _ = cmd_line;

        match tokio::time::timeout(std::time::Duration::from_secs(120), rx).await {
            Ok(Ok(Ok(data))) => Ok(data),
            Ok(Ok(Err(err_msg))) => anyhow::bail!(err_msg),
            Ok(Err(_)) => anyhow::bail!("RPC channel dropped"),
            Err(_) => anyhow::bail!("RPC command timed out"),
        }
    }

    pub async fn stop_session(&self, session_id: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.child_stdin = None;
            if let Some(mut child) = session.child.take() {
                let _ = child.kill().await;
            }
            session.info.running = false;
            let mut p = session.pending.lock().await;
            for (_, tx) in p.drain() {
                let _ = tx.send(Err("Session stopped".into()));
            }
        }
        Ok(())
    }
}

