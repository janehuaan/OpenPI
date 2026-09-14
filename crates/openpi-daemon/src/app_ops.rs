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
            Ok(ServerMessage::ok(id, serde_json::json!(tasks_with_runs)))
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
                cwd,
                schedule: schedule_raw,
                status: "active".to_string(),
                next_run_at: next_run,
                created_at: now.to_rfc3339(),
                updated_at: now.to_rfc3339(),
                model,
                steps: steps_str,
            };

            storage.insert_task(&task_rec)?;
            info!("Created task {} via Rust daemon", task_id);
            Ok(ServerMessage::ok(id, serde_json::json!({ "taskId": task_id })))
        }

        "set_task_paused" => {
            let task_id = op.get("taskId").and_then(|t| t.as_str()).unwrap_or_default();
            let paused = op.get("paused").and_then(|p| p.as_bool()).unwrap_or(false);
            let updated = storage.set_task_paused(task_id, paused)?;
            Ok(ServerMessage::ok(id, serde_json::json!({ "updated": updated })))
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

        // --- Memory ops ---
        "list_memory" => {
            let cwd = op.get("cwd").and_then(|c| c.as_str()).unwrap_or(".");
            let scope = op.get("scope").and_then(|s| s.as_str());
            let entries = storage.list_memory(cwd, scope)?;
            Ok(ServerMessage::ok(id, serde_json::json!(entries)))
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
                cwd,
                scope,
                entry_type,
                key,
                value,
                body,
                created_at: now.clone(),
                updated_at: now,
            };

            storage.upsert_memory(&rec)?;
            Ok(ServerMessage::ok(id, serde_json::json!({ "saved": true })))
        }

        "delete_memory" => {
            let cwd = op.get("cwd").and_then(|c| c.as_str()).unwrap_or(".");
            let scope = op.get("scope").and_then(|s| s.as_str());
            let entry_type = op.get("type").and_then(|t| t.as_str()).unwrap_or("");
            let key = op.get("key").and_then(|k| k.as_str()).unwrap_or("");
            let deleted = storage.delete_memory(cwd, scope, entry_type, key)?;
            Ok(ServerMessage::ok(id, serde_json::json!({ "deleted": deleted })))
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
