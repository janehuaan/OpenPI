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
            Ok(ServerMessage::ok(id, serde_json::json!(null)))
        }

        "read_run_log" => {
            Ok(ServerMessage::ok(id, serde_json::json!({ "text": "", "truncated": false })))
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
                entry_type,
                key,
                value,
                body,
                created_at: now.clone(),
                updated_at: now,
            };

            storage.upsert_memory(&rec)?;
            let entries = storage.list_memory(&cwd, Some(&scope)).unwrap_or_default();
            Ok(ServerMessage::ok(id, serde_json::json!({ "entries": entries })))
        }

        "delete_memory" => {
            let cwd = op.get("cwd").and_then(|c| c.as_str()).unwrap_or(".");
            let scope = op.get("scope").and_then(|s| s.as_str());
            let entry_type = op.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let key = op.get("key").and_then(|k| k.as_str()).unwrap_or("");
            let _ = storage.delete_memory(cwd, scope, entry_type, key)?;
            let entries = storage.list_memory(cwd, scope).unwrap_or_default();
            Ok(ServerMessage::ok(id, serde_json::json!({ "entries": entries })))
        }

        "memory_meta" => {
            let cwd = op.get("cwd").and_then(|c| c.as_str()).unwrap_or(".");
            let proj_entries = storage.list_memory(cwd, Some("project")).unwrap_or_default();
            let glob_entries = storage.list_memory(cwd, Some("global")).unwrap_or_default();
            Ok(ServerMessage::ok(id, serde_json::json!({
                "meta": {},
                "projectCount": proj_entries.len(),
                "globalCount": glob_entries.len(),
                "archiveCount": 0,
                "digestCount": 0,
                "latestDigest": serde_json::Value::Null,
                "hasVectors": false,
                "hasLexicon": false,
                "features": {
                    "proactiveInject": false,
                    "softExtractEveryTurn": false,
                    "autoSessionDigest": false,
                    "promoteUserToGlobal": false,
                    "searchArchive": false
                }
            })))
        }

        "maintain_memory" => {
            Ok(ServerMessage::ok(id, serde_json::json!({
                "project": { "before": 0, "after": 0, "merged": 0, "pruned": 0 },
                "global": { "before": 0, "after": 0, "merged": 0, "pruned": 0 }
            })))
        }

        "list_archived_memory" | "restore_archived_memory" => {
            Ok(ServerMessage::ok(id, serde_json::json!({ "entries": [] })))
        }

        "get_memory_hub" => {
            Ok(ServerMessage::ok(id, serde_json::json!({
                "summary": "",
                "handbook": "",
                "rolloutSummaries": [],
                "skills": [],
                "stats": {
                    "pending": 0,
                    "running": 0,
                    "completed": 0,
                    "failed": 0,
                    "unconsolidatedStage1": 0
                },
                "recentJobs": []
            })))
        }

        "save_memory_handbook" | "trigger_memory_consolidation" => {
            Ok(ServerMessage::ok(id, serde_json::json!({ "ok": true })))
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

        "capabilities" | "add_extension" | "remove_extension" | "install_package" | "remove_package" => {
            Ok(ServerMessage::ok(id, serde_json::json!({
                "agentDir": "",
                "entries": []
            })))
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
            Ok(ServerMessage::ok(id, serde_json::json!({ "name": "document", "text": "", "truncated": false })))
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
