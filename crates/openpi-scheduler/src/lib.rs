pub mod dag;

use std::str::FromStr;
use chrono::{DateTime, Utc};
use cron::Schedule;
use openpi_storage::{Storage, TaskRunRecord};
use tracing::info;
use uuid::Uuid;

pub use dag::{DagEngine, TaskStep};

#[derive(Clone)]
pub struct Scheduler {
    storage: Storage,
}

impl Scheduler {
    pub fn new(storage: Storage) -> Self {
        Self { storage }
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

        info!("Triggered run {} for task '{}' ({})", run_id, task.title, trigger);
        Ok(run)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
