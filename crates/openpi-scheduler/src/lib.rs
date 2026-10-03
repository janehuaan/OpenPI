pub mod dag;

use std::collections::HashMap;
use std::fs::{create_dir_all, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use chrono::{DateTime, Utc};
use cron::Schedule;
use openpi_storage::{Storage, TaskRunRecord};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use tracing::info;
use uuid::Uuid;

pub use dag::{DagEngine, TaskStep};

pub fn openpi_runs_dir() -> PathBuf {
    if let Ok(p) = std::env::var("OPENPI_DIR") {
        PathBuf::from(p).join("runs")
    } else {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".openpi").join("runs")
    }
}

pub struct TaskLogWriter {
    pub run_id: String,
    stdout_file: Option<File>,
    stderr_file: Option<File>,
    combined_file: Option<File>,
}

impl TaskLogWriter {
    pub fn new(run_id: &str) -> Self {
        let dir = openpi_runs_dir();
        let _ = create_dir_all(&dir);

        let stdout_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(format!("{}.stdout.log", run_id)))
            .ok();

        let stderr_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(format!("{}.stderr.log", run_id)))
            .ok();

        let combined_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(format!("{}.log", run_id)))
            .ok();

        Self {
            run_id: run_id.to_string(),
            stdout_file,
            stderr_file,
            combined_file,
        }
    }

    pub fn write_stdout(&mut self, text: &str) {
        if let Some(ref mut f) = self.stdout_file {
            let _ = f.write_all(text.as_bytes());
            let _ = f.flush();
        }
        if let Some(ref mut f) = self.combined_file {
            let _ = f.write_all(text.as_bytes());
            let _ = f.flush();
        }
    }

    pub fn write_stderr(&mut self, text: &str) {
        if let Some(ref mut f) = self.stderr_file {
            let _ = f.write_all(text.as_bytes());
            let _ = f.flush();
        }
        if let Some(ref mut f) = self.combined_file {
            let _ = f.write_all(text.as_bytes());
            let _ = f.flush();
        }
    }
}

#[derive(Clone)]
pub struct Scheduler {
    pub storage: Storage,
    active_runs: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl Scheduler {
    pub fn new(storage: Storage) -> Self {
        Self {
            storage,
            active_runs: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn compute_next_run(schedule_raw: &str, from: DateTime<Utc>) -> Option<DateTime<Utc>> {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(schedule_raw) {
            match val.get("kind").and_then(|k| k.as_str()) {
                Some("once") => {
                    if let Some(run_at_str) = val.get("runAt").and_then(|r| r.as_str()) {
                        if let Ok(dt) = DateTime::parse_from_rfc3339(run_at_str) {
                            let utc = dt.with_timezone(&Utc);
                            if utc > from {
                                return Some(utc);
                            }
                        }
                    }
                }
                Some("cron") => {
                    if let Some(expr) = val.get("expression").and_then(|e| e.as_str()) {
                        // cron crate standard supports 7-field or standard expressions
                        // If 5 fields (e.g. * * * * *), prefix with "0 " for seconds
                        let expr_full = if expr.split_whitespace().count() == 5 {
                            format!("0 {}", expr)
                        } else {
                            expr.to_string()
                        };
                        if let Ok(schedule) = Schedule::from_str(&expr_full) {
                            return schedule.after(&from).next();
                        }
                    }
                }
                _ => {}
            }
        }
        None
    }

    pub fn trigger_task(&self, task_id: &str, trigger: &str) -> anyhow::Result<TaskRunRecord> {
        let task = self.storage.get_task(task_id)?
            .ok_or_else(|| anyhow::anyhow!("Task not found: {}", task_id))?;

        let run_id = format!("run-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();

        let run = TaskRunRecord {
            id: run_id.clone(),
            task_id: task.id.clone(),
            status: "running".into(),
            trigger: trigger.into(),
            created_at: now.clone(),
            started_at: Some(now.clone()),
            finished_at: None,
            exit_code: None,
            result: None,
            error: None,
            attempt: Some(1),
        };

        self.storage.insert_run(&run)?;

        // Register cancellation token
        let token = CancellationToken::new();
        let runs_map = self.active_runs.clone();
        let rid = run_id.clone();
        tokio::spawn(async move {
            let mut map = runs_map.lock().await;
            map.insert(rid, token);
        });

        info!("Triggered run {} for task '{}' ({})", run_id, task.title, trigger);
        Ok(run)
    }

    pub async fn register_active_run(&self, run_id: &str, token: CancellationToken) {
        let mut map = self.active_runs.lock().await;
        map.insert(run_id.to_string(), token);
    }

    pub async fn unregister_active_run(&self, run_id: &str) {
        let mut map = self.active_runs.lock().await;
        map.remove(run_id);
    }

    pub async fn get_cancel_token(&self, run_id: &str) -> Option<CancellationToken> {
        let map = self.active_runs.lock().await;
        map.get(run_id).cloned()
    }

    pub async fn cancel_run(&self, run_id: &str) -> anyhow::Result<Option<TaskRunRecord>> {
        {
            let mut map = self.active_runs.lock().await;
            if let Some(token) = map.remove(run_id) {
                token.cancel();
            }
        }

        let updated = self.storage.cancel_run(run_id)?;

        // Append cancellation notice to log if exists
        let mut writer = TaskLogWriter::new(run_id);
        writer.write_stderr("\n[Task run cancelled by user]\n");

        Ok(updated)
    }

    pub async fn complete_run(
        &self,
        run_id: &str,
        status: &str,
        exit_code: i32,
        result: Option<&str>,
        error: Option<&str>,
    ) -> anyhow::Result<()> {
        self.unregister_active_run(run_id).await;
        let finished_at = Utc::now().to_rfc3339();
        self.storage.update_run_finish(run_id, status, exit_code, result, error, &finished_at)?;
        Ok(())
    }

    pub fn advance_task_schedule(&self, task_id: &str) -> anyhow::Result<Option<DateTime<Utc>>> {
        let task = match self.storage.get_task(task_id)? {
            Some(t) => t,
            None => return Ok(None),
        };

        let now = Utc::now();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&task.schedule) {
            match val.get("kind").and_then(|k| k.as_str()) {
                Some("cron") => {
                    let next = Self::compute_next_run(&task.schedule, now);
                    self.storage.update_task_next_run(
                        task_id,
                        next.map(|dt| dt.to_rfc3339()).as_deref(),
                        None,
                    )?;
                    return Ok(next);
                }
                Some("once") => {
                    self.storage.update_task_next_run(task_id, None, Some("completed"))?;
                    return Ok(None);
                }
                _ => {}
            }
        }

        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openpi_storage::TaskRecord;

    #[test]
    fn test_dag_engine_sorting() {
        let steps = vec![
            TaskStep {
                id: "step-build".into(),
                title: "Build".into(),
                prompt: "Run build".into(),
                depends_on: vec!["step-lint".into()],
                tools: vec![],
            },
            TaskStep {
                id: "step-lint".into(),
                title: "Lint".into(),
                prompt: "Run lint".into(),
                depends_on: vec![],
                tools: vec![],
            },
            TaskStep {
                id: "step-test".into(),
                title: "Test".into(),
                prompt: "Run tests".into(),
                depends_on: vec!["step-build".into()],
                tools: vec![],
            },
        ];

        let engine = DagEngine::from_steps(&steps).unwrap();
        let plan = engine.plan_execution().unwrap();
        assert_eq!(plan.len(), 3);
        assert_eq!(plan[0].id, "step-lint");
        assert_eq!(plan[1].id, "step-build");
        assert_eq!(plan[2].id, "step-test");
    }

    #[test]
    fn test_scheduler_cron_next_run() {
        let now = Utc::now();
        let cron_schedule = r#"{"kind":"cron","expression":"* * * * *"}"#;
        let next = Scheduler::compute_next_run(cron_schedule, now);
        assert!(next.is_some());
        assert!(next.unwrap() > now);
    }

    #[tokio::test]
    async fn test_scheduler_lifecycle() {
        let storage = Storage::in_memory().unwrap();
        let scheduler = Scheduler::new(storage.clone());

        let task = TaskRecord {
            id: "t-sched".into(),
            title: "Scheduled Task".into(),
            prompt: "Do work".into(),
            cwd: None,
            schedule: r#"{"kind":"cron","expression":"0 0 * * *"}"#.into(),
            status: "active".into(),
            next_run_at: None,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
            model: None,
            steps: None,
        };
        storage.insert_task(&task).unwrap();

        // 1. Advance schedule
        let next = scheduler.advance_task_schedule("t-sched").unwrap();
        assert!(next.is_some());
        let updated_task = storage.get_task("t-sched").unwrap().unwrap();
        assert!(updated_task.next_run_at.is_some());

        // 2. Trigger task
        let run = scheduler.trigger_task("t-sched", "manual").unwrap();
        assert_eq!(run.status, "running");

        // 3. Complete run
        scheduler.complete_run(&run.id, "succeeded", 0, Some("Finished successfully"), None).await.unwrap();
        let fetched_run = storage.get_run(&run.id).unwrap().unwrap();
        assert_eq!(fetched_run.status, "succeeded");
        assert_eq!(fetched_run.exit_code, Some(0));
        assert_eq!(fetched_run.result.as_deref(), Some("Finished successfully"));

        // 4. Test cancel run
        let run2 = scheduler.trigger_task("t-sched", "cron").unwrap();
        let cancelled = scheduler.cancel_run(&run2.id).await.unwrap().unwrap();
        assert_eq!(cancelled.status, "cancelled");
    }
}
