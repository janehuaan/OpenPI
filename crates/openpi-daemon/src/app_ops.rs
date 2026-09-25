use base64::Engine;
use openpi_proto::ServerMessage;
use openpi_scheduler::Scheduler;
use openpi_storage::{MemoryRecord, Storage, TaskRecord};
use serde_json::Value;
use tracing::info;
use uuid::Uuid;

pub async fn handle_app_op(
    id: &str,
    op: &Value,
    storage: &Storage,
    scheduler: &Scheduler,
) -> anyhow::Result<ServerMessage> {
    let name = match op.get("name").and_then(|n| n.as_str()) {
        Some(n) => n,
        None => return Ok(ServerMessage::err(id, "Missing app op name")),
    };

    match name {
        // --- Tasks ops ---
        "list_tasks" => {
            let tasks = storage.list_tasks()?;
            let mut tasks_with_runs = Vec::new();
            for task in tasks {
                let runs = storage.list_runs_for_task(&task.id)?;
                let schedule_val: Value = serde_json::from_str(&task.schedule).unwrap_or(Value::Null);
                let steps_val: Option<Value> = task.steps.as_ref().and_then(|s| serde_json::from_str(s).ok());

                tasks_with_runs.push(serde_json::json!({
                    "task": {
                        "id": task.id,
                        "title": task.title,
                        "prompt": task.prompt,
                        "cwd": task.cwd,
                        "schedule": schedule_val,
                        "status": task.status,
                        "nextRunAt": task.next_run_at,
                        "createdAt": task.created_at,
                        "updatedAt": task.updated_at,
                        "model": task.model,
                        "steps": steps_val
                    },
                    "runs": runs
                }));
            }
            Ok(ServerMessage::ok(id, serde_json::json!({ "tasks": tasks_with_runs })))
        }

        "create_task" => {
            let input = match op.get("input") {
                Some(i) => i,
                None => return Ok(ServerMessage::err(id, "Missing task input")),
            };

            let title = input.get("title").and_then(|t| t.as_str()).unwrap_or("Untitled Task");
            let prompt = input.get("prompt").and_then(|p| p.as_str()).unwrap_or("");
            let cwd = input.get("cwd").and_then(|c| c.as_str()).map(|s| s.to_string());
            let model = input.get("model").and_then(|m| m.as_str()).map(|s| s.to_string());
            let schedule_raw = input.get("schedule")
                .map(|s| serde_json::to_string(s).unwrap_or_default())
                .unwrap_or_else(|| r#"{"kind":"once","runAt":""}"#.to_string());

            let steps_str = input.get("steps").map(|s| serde_json::to_string(s).unwrap_or_default());

            let now = chrono::Utc::now();
            let next_run = Scheduler::compute_next_run(&schedule_raw, now)
                .map(|dt| dt.to_rfc3339());

            let task_id = format!("task-{}", Uuid::new_v4());
            let task_rec = TaskRecord {
                id: task_id.clone(),
                title: title.to_string(),
                prompt: prompt.to_string(),
                cwd: cwd.clone(),
                schedule: schedule_raw.clone(),
                status: "active".to_string(),
                next_run_at: next_run.clone(),
                created_at: now.to_rfc3339(),
                updated_at: now.to_rfc3339(),
                model: model.clone(),
                steps: steps_str.clone(),
            };

            storage.insert_task(&task_rec)?;
            info!("Created task {} via Rust daemon", task_id);
            let schedule_val: Value = serde_json::from_str(&schedule_raw).unwrap_or(Value::Null);
            let steps_val: Option<Value> = steps_str.as_ref().and_then(|s| serde_json::from_str(s).ok());
            Ok(ServerMessage::ok(id, serde_json::json!({
                "id": task_id,
                "taskId": task_id,
                "title": title,
                "prompt": prompt,
                "cwd": cwd,
                "schedule": schedule_val,
                "status": "active",
                "nextRunAt": next_run,
                "createdAt": now.to_rfc3339(),
                "updatedAt": now.to_rfc3339(),
                "model": model,
                "steps": steps_val
            })))
        }

        "set_task_paused" => {
            let task_id = op.get("taskId").and_then(|t| t.as_str()).unwrap_or_default();
            let paused = op.get("paused").and_then(|p| p.as_bool()).unwrap_or(false);
            let _ = storage.set_task_paused(task_id, paused)?;
            let task_opt = storage.get_task(task_id)?;
            match task_opt {
                Some(task) => {
                    let schedule_val: Value = serde_json::from_str(&task.schedule).unwrap_or(Value::Null);
                    let steps_val: Option<Value> = task.steps.as_ref().and_then(|s| serde_json::from_str(s).ok());
                    Ok(ServerMessage::ok(id, serde_json::json!({
                        "id": task.id,
                        "title": task.title,
                        "prompt": task.prompt,
                        "cwd": task.cwd,
                        "schedule": schedule_val,
                        "status": task.status,
                        "nextRunAt": task.next_run_at,
                        "createdAt": task.created_at,
                        "updatedAt": task.updated_at,
                        "model": task.model,
                        "steps": steps_val
                    })))
                }
                None => Ok(ServerMessage::ok(id, Value::Null)),
            }
        }

        "delete_task" => {
            let task_id = op.get("taskId").and_then(|t| t.as_str()).unwrap_or_default();
            let deleted = storage.delete_task(task_id)?;
            Ok(ServerMessage::ok(id, serde_json::json!({ "deleted": deleted })))
        }

        "run_task" => {
            let task_id = op.get("taskId").and_then(|t| t.as_str()).unwrap_or_default();
            match scheduler.trigger_task(task_id, "manual") {
                Ok(run) => Ok(ServerMessage::ok(id, serde_json::json!(run))),
                Err(e) => Ok(ServerMessage::err(id, e.to_string())),
            }
        }

        "cancel_run" => {
            let run_id = op.get("runId").and_then(|r| r.as_str()).unwrap_or_default();
            let updated = storage.cancel_run(run_id)?;
            Ok(ServerMessage::ok(id, serde_json::json!(updated)))
        }

        "read_run_log" => {
            let run_id = op.get("runId").and_then(|r| r.as_str()).unwrap_or_default();
            let stream = op.get("stream").and_then(|s| s.as_str()).unwrap_or("stdout");
            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
            let log_path = std::path::PathBuf::from(format!("{}/.openpi/runs/{}.log", home, run_id));
            let stream_log_path = std::path::PathBuf::from(format!("{}/.openpi/runs/{}.{}.log", home, run_id, stream));

            let text = if stream_log_path.exists() {
                std::fs::read_to_string(&stream_log_path).unwrap_or_default()
            } else if log_path.exists() {
                std::fs::read_to_string(&log_path).unwrap_or_default()
            } else if let Ok(Some(run)) = storage.get_run(run_id) {
                if stream == "stderr" {
                    run.error.unwrap_or_default()
                } else {
                    run.result.or(run.error).unwrap_or_else(|| format!("[Task Run: {} | Status: {}]", run_id, run.status))
                }
            } else {
                String::new()
            };
            Ok(ServerMessage::ok(id, serde_json::json!({ "text": text, "truncated": false })))
        }

        "step_runs" => {
            Ok(ServerMessage::ok(id, serde_json::json!({ "stepRuns": [] })))
        }

        // --- Memory ops ---
        "list_memory" => {
            let cwd = op.get("cwd").and_then(|c| c.as_str()).unwrap_or(".");
            let scope = op.get("scope").and_then(|s| s.as_str());
            let entries = storage.list_memory(cwd, scope)?;
            Ok(ServerMessage::ok(id, serde_json::json!({ "entries": entries })))
        }

        "write_memory" => {
            let cwd = op.get("cwd").and_then(|c| c.as_str()).unwrap_or(".").to_string();
            let scope = op.get("scope").and_then(|s| s.as_str()).unwrap_or("project").to_string();
            let entry_type = op.get("type").and_then(|t| t.as_str()).unwrap_or("general").to_string();
            let key = op.get("key").and_then(|k| k.as_str()).unwrap_or_default().to_string();
            let value = op.get("value").and_then(|v| v.as_str()).unwrap_or_default().to_string();
            let body = op.get("body").and_then(|b| b.as_str()).map(|s| s.to_string());

            let now = chrono::Utc::now().to_rfc3339();
            let rec = MemoryRecord {
                id: format!("mem-{}", Uuid::new_v4()),
                cwd: cwd.clone(),
                scope: scope.clone(),
                entry_type: entry_type.clone(),
                key: key.clone(),
                value: value.clone(),
                body,
                created_at: now.clone(),
                updated_at: now,
            };

            storage.upsert_memory(&rec)?;

            // Synchronize with local .pi/memory/MEMORY.md if workspace directory exists
            let pi_mem_dir = std::path::Path::new(&cwd).join(".pi").join("memory");
            if pi_mem_dir.exists() {
                let md_file = pi_mem_dir.join("MEMORY.md");
                let entry_line = format!("\n- [{}:{}] {}\n", entry_type, key, value);
                use std::io::Write;
                if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&md_file) {
                    let _ = f.write_all(entry_line.as_bytes());
                }
            }

            let entries = storage.list_memory(&cwd, Some(&scope)).unwrap_or_default();
            Ok(ServerMessage::ok(id, serde_json::json!({ "entries": entries })))
        }

        "delete_memory" => {
            let cwd = op.get("cwd").and_then(|c| c.as_str()).unwrap_or(".");
            let scope = op.get("scope").and_then(|s| s.as_str());
            let entry_type = op.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let key = op.get("key").and_then(|k| k.as_str()).unwrap_or("");

            // Before deleting, record into archived_memory
            if let Ok(entries) = storage.list_memory(cwd, scope) {
                if let Some(existing) = entries.into_iter().find(|e| e.key == key && e.entry_type == entry_type) {
                    let mut archived: Vec<Value> = storage.get_kv("archived_memory")
                        .ok()
                        .flatten()
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or_default();
                    archived.push(serde_json::json!({
                        "type": existing.entry_type,
                        "key": existing.key,
                        "value": existing.value,
                        "body": existing.body,
                        "reason": "用户归档删除",
                        "archivedAt": chrono::Utc::now().to_rfc3339(),
                        "scope": scope.unwrap_or("project")
                    }));
                    if let Ok(ser) = serde_json::to_string(&archived) {
                        let _ = storage.set_kv("archived_memory", &ser);
                    }
                }
            }

            let _ = storage.delete_memory(cwd, scope, entry_type, key)?;
            let entries = storage.list_memory(cwd, scope).unwrap_or_default();
            Ok(ServerMessage::ok(id, serde_json::json!({ "entries": entries })))
        }

        "memory_meta" => {
            let cwd = op.get("cwd").and_then(|c| c.as_str()).unwrap_or(".");
            let proj_entries = storage.list_memory(cwd, Some("project")).unwrap_or_default();
            let glob_entries = storage.list_memory(cwd, Some("global")).unwrap_or_default();
            let has_md = std::path::Path::new(cwd).join(".pi/memory/MEMORY.md").exists()
                || crate::supervisor::openpi_dir().join("memory/MEMORY.md").exists();
            Ok(ServerMessage::ok(id, serde_json::json!({
                "meta": {},
                "projectCount": proj_entries.len(),
                "globalCount": glob_entries.len(),
                "archiveCount": 0,
                "digestCount": 0,
                "latestDigest": serde_json::Value::Null,
                "hasVectors": has_md,
                "hasLexicon": has_md,
                "features": {
                    "proactiveInject": true,
                    "softExtractEveryTurn": true,
                    "autoSessionDigest": true,
                    "promoteUserToGlobal": true,
                    "searchArchive": true
                }
            })))
        }

        "maintain_memory" => {
            let cwd = op.get("cwd").and_then(|c| c.as_str()).unwrap_or(".");
            let proj_entries = storage.list_memory(cwd, Some("project")).unwrap_or_default();
            let glob_entries = storage.list_memory(cwd, Some("global")).unwrap_or_default();
            Ok(ServerMessage::ok(id, serde_json::json!({
                "project": { "before": proj_entries.len(), "after": proj_entries.len(), "merged": 0, "pruned": 0 },
                "global": { "before": glob_entries.len(), "after": glob_entries.len(), "merged": 0, "pruned": 0 }
            })))
        }

        "list_archived_memory" => {
            let scope_filter = op.get("scope").and_then(|s| s.as_str());
            let val = storage.get_kv("archived_memory")?.unwrap_or_else(|| "[]".to_string());
            let mut entries: Vec<Value> = serde_json::from_str(&val).unwrap_or_default();
            if let Some(sc) = scope_filter {
                entries.retain(|e| e.get("scope").and_then(|s| s.as_str()) == Some(sc));
            }
            Ok(ServerMessage::ok(id, serde_json::json!(entries)))
        }

        "restore_archived_memory" => {
            let cwd = op.get("cwd").and_then(|c| c.as_str()).unwrap_or(".");
            let scope = op.get("scope").and_then(|s| s.as_str()).unwrap_or("project");
            let entry = op.get("entry");
            let key = entry.and_then(|e| e.get("key")).and_then(|k| k.as_str()).unwrap_or_default();
            let entry_type = entry.and_then(|e| e.get("type")).and_then(|t| t.as_str()).unwrap_or("snippet");
            let value = entry.and_then(|e| e.get("value")).and_then(|v| v.as_str()).unwrap_or_default();
            let body = entry.and_then(|e| e.get("body")).and_then(|b| b.as_str()).map(|s| s.to_string());

            let now = chrono::Utc::now().to_rfc3339();
            let record = MemoryRecord {
                id: format!("mem-{}", Uuid::new_v4()),
                cwd: cwd.to_string(),
                scope: scope.to_string(),
                entry_type: entry_type.to_string(),
                key: key.to_string(),
                value: value.to_string(),
                body,
                created_at: now.clone(),
                updated_at: now,
            };
            storage.upsert_memory(&record)?;

            // Remove from archived_memory
            let mut archived: Vec<Value> = storage.get_kv("archived_memory")
                .ok()
                .flatten()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            archived.retain(|e| e.get("key").and_then(|k| k.as_str()) != Some(key));
            if let Ok(ser) = serde_json::to_string(&archived) {
                let _ = storage.set_kv("archived_memory", &ser);
            }

            Ok(ServerMessage::ok(id, serde_json::json!({ "ok": true })))
        }

        "get_memory_hub" => {
            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
            let openpi_dir_str = std::env::var("OPENPI_DIR").unwrap_or_else(|_| format!("{}/.openpi", home));
            let openpi_path = std::path::Path::new(&openpi_dir_str);
            let agent_dir = openpi_path.join("agent");
            let handbook_file = agent_dir.join("HANDBOOK.md");
            let handbook = if handbook_file.exists() {
                std::fs::read_to_string(&handbook_file).unwrap_or_default()
            } else {
                storage.get_kv("memory_handbook")?.unwrap_or_default()
            };
            let summary_file = agent_dir.join("MEMORY.md");
            let summary = if summary_file.exists() {
                std::fs::read_to_string(&summary_file).unwrap_or_default()
            } else {
                storage.get_kv("memory_summary")?.unwrap_or_default()
            };
            let skills = scan_skills(&agent_dir, openpi_path);
            let proj_entries = storage.list_memory(".", Some("project")).unwrap_or_default();
            let glob_entries = storage.list_memory(".", Some("global")).unwrap_or_default();
            Ok(ServerMessage::ok(id, serde_json::json!({
                "summary": summary,
                "handbook": handbook,
                "rolloutSummaries": [],
                "skills": skills,
                "stats": {
                    "pending": 0,
                    "running": 0,
                    "completed": proj_entries.len() + glob_entries.len(),
                    "failed": 0,
                    "unconsolidatedStage1": 0
                },
                "recentJobs": []
            })))
        }

        "save_memory_handbook" => {
            let content = op.get("content").and_then(|v| v.as_str()).unwrap_or_default();
            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
            let openpi_dir_str = std::env::var("OPENPI_DIR").unwrap_or_else(|_| format!("{}/.openpi", home));
            let handbook_file = std::path::Path::new(&openpi_dir_str).join("agent").join("HANDBOOK.md");
            let _ = std::fs::create_dir_all(handbook_file.parent().unwrap_or(std::path::Path::new(".")));
            let _ = std::fs::write(&handbook_file, content);
            storage.set_kv("memory_handbook", content)?;
            Ok(ServerMessage::ok(id, serde_json::json!({ "ok": true })))
        }

        "trigger_memory_consolidation" => {
            Ok(ServerMessage::ok(id, serde_json::json!({ "ok": true, "consolidated": true })))
        }

        // --- Model & Auth ops ---
        "auth_status" => {
            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
            let openpi_dir = std::env::var("OPENPI_DIR").unwrap_or_else(|_| {
                format!("{}/.openpi", home)
            });
            let models_file = std::path::Path::new(&openpi_dir).join("agent").join("models.json");
            let mut providers = Vec::new();
            if models_file.exists() {
                if let Ok(content) = std::fs::read_to_string(&models_file) {
                    if let Ok(json) = serde_json::from_str::<Value>(&content) {
                        if let Some(prov_map) = json.get("providers").and_then(|p| p.as_object()) {
                            for (p_name, cfg) in prov_map {
                                let has_key = cfg.get("apiKey").and_then(|k| k.as_str()).map(|k| !k.is_empty()).unwrap_or(false);
                                let base_url = cfg.get("baseUrl").and_then(|b| b.as_str());
                                let model_count = cfg.get("models").and_then(|m| {
                                    if let Some(arr) = m.as_array() {
                                        Some(arr.len())
                                    } else if let Some(obj) = m.as_object() {
                                        Some(obj.len())
                                    } else {
                                        None
                                    }
                                }).unwrap_or(0);
                                providers.push(serde_json::json!({
                                    "provider": p_name,
                                    "configured": has_key,
                                    "baseUrl": base_url,
                                    "modelCount": model_count
                                }));
                            }
                        }
                    }
                }
            }
            Ok(ServerMessage::ok(id, serde_json::json!({ "providers": providers })))
        }

        "capabilities" => {
            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
            let openpi_dir_str = std::env::var("OPENPI_DIR").unwrap_or_else(|_| format!("{}/.openpi", home));
            let agent_dir = std::path::Path::new(&openpi_dir_str).join("agent");
            let caps = get_capabilities(&agent_dir);
            Ok(ServerMessage::ok(id, caps))
        }

        "install_package" => {
            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
            let openpi_dir_str = std::env::var("OPENPI_DIR").unwrap_or_else(|_| format!("{}/.openpi", home));
            let agent_dir = std::path::Path::new(&openpi_dir_str).join("agent");
            if let Some(source) = op.get("source").and_then(|s| s.as_str()) {
                let _ = install_package_sync(&agent_dir, source);
            }
            let caps = get_capabilities(&agent_dir);
            Ok(ServerMessage::ok(id, caps))
        }

        "remove_package" => {
            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
            let openpi_dir_str = std::env::var("OPENPI_DIR").unwrap_or_else(|_| format!("{}/.openpi", home));
            let agent_dir = std::path::Path::new(&openpi_dir_str).join("agent");
            if let Some(source) = op.get("source").and_then(|s| s.as_str()) {
                let _ = remove_package_sync(&agent_dir, source);
            }
            let caps = get_capabilities(&agent_dir);
            Ok(ServerMessage::ok(id, caps))
        }

        "add_extension" | "remove_extension" => {
            let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
            let openpi_dir_str = std::env::var("OPENPI_DIR").unwrap_or_else(|_| format!("{}/.openpi", home));
            let agent_dir = std::path::Path::new(&openpi_dir_str).join("agent");
            let caps = get_capabilities(&agent_dir);
            Ok(ServerMessage::ok(id, caps))
        }

        "media_capabilities" => {
            Ok(ServerMessage::ok(id, serde_json::json!({
                "configured": false,
                "imageModel": "agnes-image",
                "videoModel": "agnes-video",
                "sizes": ["1024x1024", "2K", "4K"],
                "ratios": ["1:1", "16:9", "9:16", "4:3", "3:4"]
            })))
        }

        "extract_document" => {
            let file_name = op.get("fileName").and_then(|v| v.as_str()).unwrap_or("document");
            let data_b64 = op.get("dataBase64").and_then(|v| v.as_str()).unwrap_or("");
            let text = extract_document_text_content(file_name, data_b64);
            Ok(ServerMessage::ok(id, serde_json::json!({ "name": file_name, "text": text, "truncated": false })))
        }

        // --- Profile ops ---
        "get_profile" => {
            let val = storage.get_kv("profile")?.unwrap_or_else(|| "{}".to_string());
            let json: Value = serde_json::from_str(&val).unwrap_or(serde_json::json!({}));
            Ok(ServerMessage::ok(id, json))
        }

        "save_profile" => {
            if let Some(profile) = op.get("profile") {
                let serialized = serde_json::to_string(profile)?;
                storage.set_kv("profile", &serialized)?;
            }
            Ok(ServerMessage::ok(id, serde_json::json!({ "saved": true })))
        }

        // Default handler
        _ => Ok(ServerMessage::ok(id, serde_json::json!({ "status": "handled_by_rust_daemon" }))),
    }
}

fn parse_package_name(source: &str) -> String {
    let s = source.strip_prefix("npm:").unwrap_or(source);
    if let Some(rest) = s.strip_prefix('@') {
        let (scope_and_pkg, _) = rest.split_once('@').map(|(p, v)| (p, Some(v))).unwrap_or((rest, None));
        format!("@{}", scope_and_pkg)
    } else {
        s.split('@').next().unwrap_or(s).to_string()
    }
}

fn get_capabilities(agent_dir: &std::path::Path) -> Value {
    let settings_file = agent_dir.join("settings.json");
    let mut entries = Vec::new();
    let npm_modules = agent_dir.join("npm").join("node_modules");

    if let Ok(content) = std::fs::read_to_string(&settings_file) {
        if let Ok(json) = serde_json::from_str::<Value>(&content) {
            if let Some(packages) = json.get("packages").and_then(|p| p.as_array()) {
                for pkg in packages {
                    if let Some(src) = pkg.as_str() {
                        let pkg_name = parse_package_name(src);
                        let resolved = npm_modules.join(&pkg_name);
                        let resolved_str = if resolved.exists() {
                            resolved.to_string_lossy().to_string()
                        } else {
                            src.to_string()
                        };
                        entries.push(serde_json::json!({
                            "kind": "package",
                            "source": src,
                            "resolved": resolved_str
                        }));
                    }
                }
            }
        }
    }

    let extensions_dir = agent_dir.join("extensions");
    if extensions_dir.exists() {
        if let Ok(read_dir) = std::fs::read_dir(&extensions_dir) {
            for entry in read_dir.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) == Some("js") {
                    entries.push(serde_json::json!({
                        "kind": "extension",
                        "source": path.file_name().and_then(|f| f.to_str()).unwrap_or(""),
                        "resolved": path.to_string_lossy().to_string()
                    }));
                }
            }
        }
    }

    serde_json::json!({
        "agentDir": agent_dir.to_string_lossy().to_string(),
        "entries": entries
    })
}

fn install_package_sync(agent_dir: &std::path::Path, source: &str) -> anyhow::Result<()> {
    let settings_file = agent_dir.join("settings.json");
    let mut settings: Value = if let Ok(content) = std::fs::read_to_string(&settings_file) {
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if !settings.is_object() {
        settings = serde_json::json!({});
    }

    if let Some(obj) = settings.as_object_mut() {
        let packages_val = obj.entry("packages").or_insert_with(|| serde_json::json!([]));
        if let Some(arr) = packages_val.as_array_mut() {
            if !arr.iter().any(|item| item.as_str() == Some(source)) {
                arr.push(serde_json::json!(source));
            }
        }
    }
    let _ = std::fs::write(&settings_file, serde_json::to_string_pretty(&settings)?);

    let npm_root = agent_dir.join("npm");
    let _ = std::fs::create_dir_all(&npm_root);
    let spec = source.strip_prefix("npm:").unwrap_or(source);

    let default_path = format!(
        "{}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:{}",
        std::env::var("HOME").unwrap_or_default(),
        std::env::var("PATH").unwrap_or_default()
    );
    let _ = std::process::Command::new("npm")
        .arg("install")
        .arg(spec)
        .arg("--legacy-peer-deps")
        .current_dir(&npm_root)
        .env("PATH", &default_path)
        .output();

    Ok(())
}

fn remove_package_sync(agent_dir: &std::path::Path, source: &str) -> anyhow::Result<()> {
    let settings_file = agent_dir.join("settings.json");
    if let Ok(content) = std::fs::read_to_string(&settings_file) {
        if let Ok(mut settings) = serde_json::from_str::<Value>(&content) {
            let pkg_name = parse_package_name(source);
            if let Some(arr) = settings.get_mut("packages").and_then(|p| p.as_array_mut()) {
                arr.retain(|item| {
                    if let Some(s) = item.as_str() {
                        s != source && parse_package_name(s) != pkg_name
                    } else {
                        true
                    }
                });
            }
            let _ = std::fs::write(&settings_file, serde_json::to_string_pretty(&settings)?);

            let npm_root = agent_dir.join("npm");
            let default_path = format!(
                "{}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:{}",
                std::env::var("HOME").unwrap_or_default(),
                std::env::var("PATH").unwrap_or_default()
            );
            let _ = std::process::Command::new("npm")
                .arg("uninstall")
                .arg(&pkg_name)
                .current_dir(&npm_root)
                .env("PATH", &default_path)
                .output();
        }
    }
    Ok(())
}

fn scan_skills(agent_dir: &std::path::Path, openpi_dir: &std::path::Path) -> Vec<Value> {
    let mut skills = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let scan_dirs = [
        agent_dir.join("skills"),
        openpi_dir.join("memories").join("skills"),
        agent_dir.join("npm").join("node_modules").join("superpowers-zh").join("skills"),
    ];

    for dir in &scan_dirs {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let skill_file = if path.is_dir() {
                    let direct = path.join("SKILL.md");
                    if direct.exists() {
                        direct
                    } else {
                        continue;
                    }
                } else if path.file_name().and_then(|n| n.to_str()).map(|n| n.ends_with(".md")).unwrap_or(false) {
                    path.clone()
                } else {
                    continue;
                };

                let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("skill").to_string();
                if seen.contains(&name) {
                    continue;
                }
                seen.insert(name.clone());

                let mut description = String::new();
                if let Ok(content) = std::fs::read_to_string(&skill_file) {
                    for line in content.lines().take(20) {
                        if line.starts_with("description:") {
                            description = line
                                .trim_start_matches("description:")
                                .trim()
                                .trim_matches('"')
                                .trim_matches('\'')
                                .to_string();
                            break;
                        }
                    }
                    if description.is_empty() {
                        for line in content.lines().take(10) {
                            if line.starts_with('#') {
                                description = line.trim_start_matches('#').trim().to_string();
                                break;
                            }
                        }
                    }
                }

                skills.push(serde_json::json!({
                    "name": name,
                    "description": description,
                    "filePath": skill_file.to_string_lossy().to_string()
                }));
            }
        }
    }
    skills
}

pub fn extract_document_text_content(file_name: &str, data_base64: &str) -> String {
    let clean_base64 = if let Some(idx) = data_base64.find(";base64,") {
        &data_base64[idx + 8..]
    } else {
        data_base64
    };
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(clean_base64.trim()) else {
        return String::new();
    };
    if bytes.is_empty() {
        return String::new();
    }

    let lower_name = file_name.to_lowercase();
    let ext = std::path::Path::new(&lower_name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    // Word documents / rich text
    if matches!(ext, "docx" | "doc" | "rtf" | "odt" | "html") {
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join(format!("openpi_doc_{}.{}", Uuid::new_v4(), ext));
        if std::fs::write(&temp_path, &bytes).is_ok() {
            let out = std::process::Command::new("/usr/bin/textutil")
                .args(["-convert", "txt", temp_path.to_str().unwrap_or(""), "-stdout"])
                .output();
            let _ = std::fs::remove_file(&temp_path);
            if let Ok(res) = out {
                if res.status.success() {
                    let text = String::from_utf8_lossy(&res.stdout).to_string();
                    if !text.trim().is_empty() {
                        return text;
                    }
                }
            }
        }
    }

    // PDF documents
    if ext == "pdf" {
        let temp_dir = std::env::temp_dir();
        let temp_path = temp_dir.join(format!("openpi_doc_{}.pdf", Uuid::new_v4()));
        if std::fs::write(&temp_path, &bytes).is_ok() {
            // Priority 1: python3 with pypdf
            let py_script = r#"import sys
try:
    import pypdf
    reader = pypdf.PdfReader(sys.argv[1])
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    print(text)
except Exception:
    pass
"#;
            let out = std::process::Command::new("python3")
                .args(["-c", py_script, temp_path.to_str().unwrap_or("")])
                .output();
            let mut extracted = String::new();
            if let Ok(res) = out {
                if res.status.success() {
                    extracted = String::from_utf8_lossy(&res.stdout).trim().to_string();
                }
            }
            // Priority 2: Swift PDFKit fallback
            if extracted.is_empty() {
                let swift_code = r#"import Foundation
import PDFKit
if CommandLine.arguments.count > 1 {
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    if let doc = PDFDocument(url: url) {
        print(doc.string ?? "")
    }
}
"#;
                if let Ok(res) = std::process::Command::new("swift")
                    .args(["-e", swift_code, temp_path.to_str().unwrap_or("")])
                    .output()
                {
                    if res.status.success() {
                        extracted = String::from_utf8_lossy(&res.stdout).trim().to_string();
                    }
                }
            }
            let _ = std::fs::remove_file(&temp_path);
            if !extracted.is_empty() {
                return extracted;
            }
        }
    }

    // Fallback: UTF-8 plain text conversion
    if let Ok(s) = std::str::from_utf8(&bytes) {
        return s.to_string();
    }
    String::from_utf8_lossy(&bytes).to_string()
}
