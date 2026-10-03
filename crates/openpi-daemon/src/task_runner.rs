use chrono::Utc;
use openpi_proto::SessionMode;
use openpi_scheduler::{DagEngine, Scheduler, TaskLogWriter, TaskStep};
use openpi_storage::{Storage, TaskRecord, TaskRunRecord, TaskStepRunRecord};
use serde_json::json;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use crate::supervisor::Supervisor;

/// 异步执行具体的任务运行实例
pub async fn execute_task_run(
    task: TaskRecord,
    run: TaskRunRecord,
    scheduler: Scheduler,
    supervisor: Supervisor,
    storage: Storage,
    pi_cli_path: String,
) {
    let run_id = run.id.clone();
    let task_id = task.id.clone();
    let mut log_writer = TaskLogWriter::new(&run_id);

    // 获取并绑定取消令牌
    let cancel_token = scheduler.get_cancel_token(&run_id).await.unwrap_or_else(|| {
        let t = CancellationToken::new();
        let s = scheduler.clone();
        let rid = run_id.clone();
        let t_clone = t.clone();
        tokio::spawn(async move {
            s.register_active_run(&rid, t_clone).await;
        });
        t
    });

    log_writer.write_stdout(&format!(
        "=== [Task Run Started] ===\nTask: {} ({})\nRun ID: {}\nTrigger: {}\nStarted At: {}\n\n",
        task.title,
        task.id,
        run_id,
        run.trigger,
        run.started_at.as_deref().unwrap_or("")
    ));

    let _ = supervisor.event_tx.send((
        "task-scheduler".to_string(),
        json!({
            "type": "task_run_started",
            "runId": run_id,
            "taskId": task.id,
            "taskTitle": task.title,
            "trigger": run.trigger
        }),
    ));

    let cwd = task.cwd.clone().unwrap_or_else(|| {
        std::env::var("HOME").unwrap_or_else(|_| ".".to_string())
    });
    let task_session_id = format!("task-session-{}", run_id);

    // 创建专属临时会话（in_memory: true，避免干扰常规桌面历史）
    let session_res = supervisor.create_session(
        task_session_id.clone(),
        cwd.clone(),
        SessionMode::Code,
        task.model.clone(),
        Some(format!("Scheduled Task: {}", task.title)),
        Some(true),
    ).await;

    if let Err(e) = session_res {
        let err_msg = format!("Failed to create task session: {}", e);
        error!("{}", err_msg);
        log_writer.write_stderr(&format!("[Error] {}\n", err_msg));
        let _ = scheduler.complete_run(&run_id, "failed", 1, None, Some(&err_msg)).await;
        let _ = supervisor.event_tx.send((
            "task-scheduler".to_string(),
            json!({
                "type": "task_run_completed",
                "runId": run_id,
                "taskId": task_id,
                "taskTitle": task.title,
                "status": "failed",
                "error": err_msg
            }),
        ));
        return;
    }

    if let Err(e) = supervisor.ensure_process(&task_session_id, &pi_cli_path).await {
        let err_msg = format!("Failed to ensure session process: {}", e);
        error!("{}", err_msg);
        log_writer.write_stderr(&format!("[Error] {}\n", err_msg));
        let _ = supervisor.delete_session(&task_session_id).await;
        let _ = scheduler.complete_run(&run_id, "failed", 1, None, Some(&err_msg)).await;
        let _ = supervisor.event_tx.send((
            "task-scheduler".to_string(),
            json!({
                "type": "task_run_completed",
                "runId": run_id,
                "taskId": task_id,
                "taskTitle": task.title,
                "status": "failed",
                "error": err_msg
            }),
        ));
        return;
    }

    // 检查是否有 DAG Steps
    let steps: Vec<TaskStep> = task.steps.as_ref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    let exec_result: Result<String, String> = if steps.is_empty() {
        // 单提示词直接执行
        execute_turn(
            &task_session_id,
            &task.prompt,
            &supervisor,
            &mut log_writer,
            cancel_token.clone(),
        ).await
    } else {
        // 多步骤 DAG 拓扑排序执行
        execute_dag_steps(
            &task_session_id,
            &run_id,
            &steps,
            &supervisor,
            &storage,
            &mut log_writer,
            cancel_token.clone(),
        ).await
    };

    // 清理临时会话
    let _ = supervisor.stop_session(&task_session_id).await;
    let _ = supervisor.delete_session(&task_session_id).await;

    // 回写最终结果并广播给前端与灵动岛
    if cancel_token.is_cancelled() {
        log_writer.write_stderr("\n=== [Task Run Cancelled] ===\n");
        let _ = scheduler.complete_run(&run_id, "cancelled", 130, None, Some("Cancelled by user")).await;
        let _ = supervisor.event_tx.send((
            "task-scheduler".to_string(),
            json!({
                "type": "task_run_completed",
                "runId": run_id,
                "taskId": task_id,
                "taskTitle": task.title,
                "status": "cancelled"
            }),
        ));
    } else {
        match exec_result {
            Ok(summary) => {
                log_writer.write_stdout(&format!("\n=== [Task Run Succeeded] ===\nSummary:\n{}\n", summary));
                let _ = scheduler.complete_run(&run_id, "succeeded", 0, Some(&summary), None).await;
                let _ = supervisor.event_tx.send((
                    "task-scheduler".to_string(),
                    json!({
                        "type": "task_run_completed",
                        "runId": run_id,
                        "taskId": task_id,
                        "taskTitle": task.title,
                        "status": "succeeded",
                        "summary": summary
                    }),
                ));
            }
            Err(err) => {
                log_writer.write_stderr(&format!("\n=== [Task Run Failed] ===\nError: {}\n", err));
                let _ = scheduler.complete_run(&run_id, "failed", 1, None, Some(&err)).await;
                let _ = supervisor.event_tx.send((
                    "task-scheduler".to_string(),
                    json!({
                        "type": "task_run_completed",
                        "runId": run_id,
                        "taskId": task_id,
                        "taskTitle": task.title,
                        "status": "failed",
                        "error": err
                    }),
                ));
            }
        }
    }

    // 推进任务下次执行时间
    if let Err(e) = scheduler.advance_task_schedule(&task_id) {
        warn!("Failed to advance schedule for task {}: {}", task_id, e);
    }
}

async fn execute_turn(
    session_id: &str,
    prompt: &str,
    supervisor: &Supervisor,
    log_writer: &mut TaskLogWriter,
    cancel_token: CancellationToken,
) -> Result<String, String> {
    let mut rx = supervisor.subscribe_events();
    let prompt_cmd = json!({
        "type": "prompt",
        "message": prompt
    });

    if let Err(e) = supervisor.send_rpc(session_id, &prompt_cmd).await {
        return Err(format!("Failed to send prompt RPC: {}", e));
    }

    let mut final_text = String::new();
    let start = std::time::Instant::now();
    let max_duration = std::time::Duration::from_secs(600); // 10 minutes timeout per step

    loop {
        if cancel_token.is_cancelled() {
            let _ = supervisor.send_rpc(session_id, &json!({ "type": "abort" })).await;
            return Err("Execution cancelled".to_string());
        }

        if start.elapsed() > max_duration {
            let _ = supervisor.send_rpc(session_id, &json!({ "type": "abort" })).await;
            return Err("Task execution timed out (exceeded 10 minutes)".to_string());
        }

        tokio::select! {
            _ = cancel_token.cancelled() => {
                let _ = supervisor.send_rpc(session_id, &json!({ "type": "abort" })).await;
                return Err("Execution cancelled".to_string());
            }
            event_res = tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()) => {
                match event_res {
                    Ok(Ok((sid, ev))) => {
                        if sid == session_id {
                            let ev_type = ev.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            match ev_type {
                                "tool_execution_start" => {
                                    let tool_name = ev.get("toolName")
                                        .or_else(|| ev.get("tool"))
                                        .or_else(|| ev.get("name"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown");
                                    let args = ev.get("args").map(|a| a.to_string()).unwrap_or_default();
                                    let line = format!("[Tool Call] {}({})\n", tool_name, args);
                                    log_writer.write_stdout(&line);
                                }
                                "tool_execution_end" => {
                                    let tool_name = ev.get("toolName")
                                        .or_else(|| ev.get("tool"))
                                        .or_else(|| ev.get("name"))
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown");
                                    let res = ev.get("result").and_then(|v| v.as_str()).unwrap_or("");
                                    let line = format!("[Tool Result] {}\n{}\n", tool_name, res);
                                    log_writer.write_stdout(&line);
                                }
                                "message_chunk" | "content_chunk" => {
                                    if let Some(text) = ev.get("text").or_else(|| ev.get("chunk")).and_then(|v| v.as_str()) {
                                        log_writer.write_stdout(text);
                                        final_text.push_str(text);
                                    }
                                }
                                "message_update" => {
                                    if let Some(am_event) = ev.get("assistantMessageEvent") {
                                        if am_event.get("type").and_then(|t| t.as_str()) == Some("text_delta") {
                                            if let Some(delta) = am_event.get("delta").and_then(|d| d.as_str()) {
                                                log_writer.write_stdout(delta);
                                                final_text.push_str(delta);
                                            }
                                        }
                                    }
                                }
                                "message" | "message_end" => {
                                    if let Some(msg) = ev.get("message") {
                                        if let Some(arr) = msg.get("content").and_then(|v| v.as_array()) {
                                            let mut parts = Vec::new();
                                            for item in arr {
                                                if item.get("type").and_then(|t| t.as_str()) == Some("text") {
                                                    if let Some(txt) = item.get("text").and_then(|t| t.as_str()) {
                                                        parts.push(txt);
                                                    }
                                                }
                                            }
                                            if !parts.is_empty() {
                                                let joined = parts.join("\n");
                                                if final_text.is_empty() {
                                                    log_writer.write_stdout(&joined);
                                                }
                                                final_text = joined;
                                            }
                                        } else if let Some(c) = msg.get("content").and_then(|v| v.as_str()) {
                                            if !c.trim().is_empty() {
                                                if final_text.is_empty() {
                                                    log_writer.write_stdout(c);
                                                }
                                                final_text = c.to_string();
                                            }
                                        }
                                    } else if let Some(c) = ev.get("content").and_then(|v| v.as_str()) {
                                        if !c.trim().is_empty() {
                                            final_text = c.to_string();
                                        }
                                    }
                                }
                                "stream_error" => {
                                    let err = ev.get("error").and_then(|v| v.as_str()).unwrap_or("Stream error");
                                    let line = format!("[Stream Error] {}\n", err);
                                    log_writer.write_stderr(&line);
                                }
                                "turn_end" | "agent_end" | "agent_settled" => {
                                    break;
                                }
                                _ => {}
                            }
                        }
                    }
                    Ok(Err(_)) => {
                        // Channel closed or lagged
                        break;
                    }
                    Err(_) => {
                        // Timeout tick: check if session is still running
                        let is_running = supervisor.is_session_running(session_id).await;
                        if !is_running {
                            break;
                        }
                    }
                }
            }
        }
    }

    if final_text.trim().is_empty() {
        final_text = "Task completed successfully.".to_string();
    }

    Ok(final_text)
}

async fn execute_dag_steps(
    session_id: &str,
    run_id: &str,
    steps: &[TaskStep],
    supervisor: &Supervisor,
    storage: &Storage,
    log_writer: &mut TaskLogWriter,
    cancel_token: CancellationToken,
) -> Result<String, String> {
    let dag = DagEngine::from_steps(steps).map_err(|e| format!("Failed to build DAG: {}", e))?;
    let plan = dag.plan_execution()?;

    log_writer.write_stdout(&format!(
        "--- DAG Plan: {} steps scheduled ---\n",
        plan.len()
    ));

    let mut step_summaries = Vec::new();

    for (idx, step) in plan.iter().enumerate() {
        if cancel_token.is_cancelled() {
            return Err("DAG execution cancelled".to_string());
        }

        let step_run_id = format!("sr-{}-{}", run_id, step.id);
        let now = Utc::now().to_rfc3339();

        let step_record = TaskStepRunRecord {
            id: step_run_id.clone(),
            run_id: run_id.to_string(),
            step_id: step.id.clone(),
            status: "running".into(),
            started_at: Some(now.clone()),
            finished_at: None,
            exit_code: None,
            error: None,
        };
        let _ = storage.insert_step_run(&step_record);

        log_writer.write_stdout(&format!(
            "\n>>> [Step {}/{}: {} ({})] <<<\nPrompt: {}\n\n",
            idx + 1, plan.len(), step.title, step.id, step.prompt
        ));

        let res = execute_turn(
            session_id,
            &step.prompt,
            supervisor,
            log_writer,
            cancel_token.clone(),
        ).await;

        let finish_now = Utc::now().to_rfc3339();

        match res {
            Ok(output) => {
                let _ = storage.update_step_run_finish(&step_run_id, "succeeded", 0, None, &finish_now);
                step_summaries.push(format!("Step '{}': {}", step.title, output));
            }
            Err(err) => {
                let _ = storage.update_step_run_finish(&step_run_id, "failed", 1, Some(&err), &finish_now);
                log_writer.write_stderr(&format!("\n[Step Failed] {}: {}\n", step.title, err));
                return Err(format!("Step '{}' failed: {}", step.title, err));
            }
        }
    }

    Ok(step_summaries.join("\n\n"))
}

/// 后台常驻定时调度轮询循环
pub async fn run_scheduler_loop(
    scheduler: Scheduler,
    supervisor: Supervisor,
    storage: Storage,
    pi_cli_path: String,
) {
    info!("Starting Scheduler Background Worker Loop (interval: 5s)...");
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));

    loop {
        interval.tick().await;

        let now = Utc::now().to_rfc3339();
        let due_tasks = match storage.get_due_tasks(&now) {
            Ok(tasks) => tasks,
            Err(e) => {
                warn!("Scheduler worker error querying due tasks: {}", e);
                continue;
            }
        };

        for task in due_tasks {
            info!("Scheduler found due task: '{}' (id: {})", task.title, task.id);

            let trigger_type = if task.schedule.contains("cron") { "cron" } else { "once" };

            // 1. 触发创建 run 记录
            let run = match scheduler.trigger_task(&task.id, trigger_type) {
                Ok(r) => r,
                Err(e) => {
                    warn!("Failed to trigger run for task {}: {}", task.id, e);
                    continue;
                }
            };

            // 2. 异步启动执行
            let t_clone = task.clone();
            let sched_clone = scheduler.clone();
            let sup_clone = supervisor.clone();
            let stor_clone = storage.clone();
            let cli_clone = pi_cli_path.clone();

            tokio::spawn(async move {
                execute_task_run(
                    t_clone,
                    run,
                    sched_clone,
                    sup_clone,
                    stor_clone,
                    cli_clone,
                ).await;
            });
        }
    }
}
