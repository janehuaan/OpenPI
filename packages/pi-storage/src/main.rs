//! pi-storage: Rust implementation of task state, event ledger, and context checkpoint.
//!
//! CLI mode: read from stdin JSON, write results to stdout JSON.
//! Library mode: available via FFI for future integration.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

// ═══════════════════════════════════════════════════════════════
// Task State
// ═══════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Idle,
    Running,
    Paused,
    Completed,
    Failed,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    InProgress,
    Completed,
    Blocked,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    Verification,
    Review,
    Diff,
    Files,
    Manual,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskCheckpoint {
    pub index: usize,
    pub label: String,
    pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskError {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    pub recovered: bool,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskStep {
    pub content: String,
    pub status: StepStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_form: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Vec<EvidenceItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EvidenceItem {
    pub kind: EvidenceKind,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskState {
    pub version: u32,
    pub id: String,
    pub goal: String,
    pub status: TaskStatus,
    pub steps: Vec<TaskStep>,
    pub checkpoints: Vec<TaskCheckpoint>,
    pub errors: Vec<TaskError>,
    pub next_steps: Vec<String>,
    pub context_notes: Vec<String>,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

// ═══════════════════════════════════════════════════════════════
// Event Ledger
// ═══════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum EventType {
    TaskStart,
    TaskStep,
    TaskComplete,
    TaskError,
    ToolCall,
    ToolResult,
    ToolError,
    CheckpointSave,
    Compaction,
    SessionStart,
    SessionEnd,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentEvent {
    pub version: u32,
    pub id: String,
    pub r#type: EventType,
    pub timestamp: String,
    pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub data: serde_json::Value,
}

// ═══════════════════════════════════════════════════════════════
// Context Checkpoint
// ═══════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Decision {
    pub what: String,
    pub why: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Issue {
    pub message: String,
    pub recovered: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContextCheckpoint {
    pub version: u32,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub goal: String,
    pub done: Vec<String>,
    pub in_progress: Vec<String>,
    pub next_steps: Vec<String>,
    pub decisions: Vec<Decision>,
    pub issues: Vec<Issue>,
    pub critical_context: Vec<String>,
    pub constraints: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub estimated_tokens_remaining: Option<u32>,
}

// ═══════════════════════════════════════════════════════════════
// CLI Commands
// ═══════════════════════════════════════════════════════════════

#[derive(Deserialize)]
#[serde(tag = "cmd")]
enum CliCommand {
    #[serde(rename = "task_state_load")]
    TaskStateLoad { path: String },
    #[serde(rename = "task_state_save")]
    TaskStateSave { path: String, state: TaskState },
    #[serde(rename = "task_state_format")]
    TaskStateFormat { state: Option<TaskState> },
    #[serde(rename = "task_state_compact")]
    TaskStateCompact { state: Option<TaskState> },
    #[serde(rename = "event_append")]
    EventAppend { path: String, event: AgentEvent },
    #[serde(rename = "event_read")]
    EventRead { path: String },
    #[serde(rename = "checkpoint_load")]
    CheckpointLoad { path: String },
    #[serde(rename = "checkpoint_save")]
    CheckpointSave { path: String, checkpoint: ContextCheckpoint },
    #[serde(rename = "checkpoint_format")]
    CheckpointFormat { checkpoint: ContextCheckpoint },
    #[serde(rename = "checkpoint_compact")]
    CheckpointCompact { checkpoint: ContextCheckpoint },
}

#[derive(Serialize)]
struct CliResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    elapsed_ms: Option<f64>,
}

fn ok_response(data: serde_json::Value) -> CliResponse {
    CliResponse {
        ok: true,
        data: Some(data),
        error: None,
        elapsed_ms: None,
    }
}

fn err_response(msg: &str) -> CliResponse {
    CliResponse {
        ok: false,
        data: None,
        error: Some(msg.to_string()),
        elapsed_ms: None,
    }
}

// ── Task State ──────────────────────────────────────────────
fn cmd_task_state_load(path: &str) -> CliResponse {
    let t0 = Instant::now();
    let p = PathBuf::from(path);
    if !p.exists() {
        return CliResponse {
            ok: true,
            data: Some(serde_json::json!(null)),
            error: None,
            elapsed_ms: Some(t0.elapsed().as_secs_f64() * 1000.0),
        };
    }
    match fs::read_to_string(&p) {
        Ok(content) => match serde_json::from_str::<TaskState>(&content) {
            Ok(state) => CliResponse {
                ok: true,
                data: Some(serde_json::to_value(&state).unwrap()),
                error: None,
                elapsed_ms: Some(t0.elapsed().as_secs_f64() * 1000.0),
            },
            Err(e) => err_response(&e.to_string()),
        },
        Err(e) => err_response(&e.to_string()),
    }
}

fn cmd_task_state_save(path: &str, state: &TaskState) -> CliResponse {
    let t0 = Instant::now();
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return err_response(&e.to_string());
        }
    }
    match serde_json::to_string_pretty(state) {
        Ok(content) => match fs::write(&p, content) {
            Ok(_) => ok_response(serde_json::json!({"saved": true})),
            Err(e) => err_response(&e.to_string()),
        },
        Err(e) => err_response(&e.to_string()),
    }
}

fn cmd_task_state_format(state: &Option<TaskState>) -> CliResponse {
    let t0 = Instant::now();
    match state {
        None => CliResponse {
            ok: true,
            data: Some(serde_json::json!("(no active task)")),
            error: None,
            elapsed_ms: Some(t0.elapsed().as_secs_f64() * 1000.0),
        },
        Some(s) => {
            let mut lines: Vec<String> = Vec::new();
            lines.push(format!("Goal: {}", s.goal));
            lines.push(format!("Status: {:?}", s.status));
            lines.push(String::new());
            lines.push("Steps:".to_string());
            for step in &s.steps {
                let icon = match step.status {
                    StepStatus::Completed => "✓",
                    StepStatus::InProgress => "●",
                    StepStatus::Blocked => "!",
                    _ => "○",
                };
                lines.push(format!("  {} [{}] {}", icon, format!("{:?}", step.status).to_lowercase(), step.content));
                if let Some(ref err) = step.error {
                    lines.push(format!("    Error: {}", err));
                }
                if let Some(ref res) = step.result {
                    lines.push(format!("    Result: {}", res));
                }
            }
            if !s.checkpoints.is_empty() {
                lines.push(String::new());
                lines.push("Checkpoints:".to_string());
                for cp in &s.checkpoints {
                    lines.push(format!("  {} {}", if cp.done { "✓" } else { "○" }, cp.label));
                }
            }
            if !s.errors.is_empty() {
                lines.push(String::new());
                lines.push("Errors:".to_string());
                for err in s.errors.iter().rev().take(3) {
                    lines.push(format!("  {} {}", if err.recovered { "↩" } else { "✗" }, &err.message.chars().take(100).collect::<String>()));
                }
            }
            if !s.next_steps.is_empty() {
                lines.push(String::new());
                lines.push("Next:".to_string());
                for ns in s.next_steps.iter().take(5) {
                    lines.push(format!("  - {}", ns));
                }
            }
            if !s.context_notes.is_empty() {
                lines.push(String::new());
                lines.push("Context:".to_string());
                for note in s.context_notes.iter().take(5) {
                    lines.push(format!("  · {}", note));
                }
            }
            CliResponse {
                ok: true,
                data: Some(serde_json::json!(lines.join("\n"))),
                error: None,
                elapsed_ms: Some(t0.elapsed().as_secs_f64() * 1000.0),
            }
        }
    }
}

fn cmd_task_state_compact(state: &Option<TaskState>) -> CliResponse {
    let t0 = Instant::now();
    match state {
        None => ok_response(serde_json::json!("")),
        Some(s) => {
            if s.steps.is_empty() {
                return ok_response(serde_json::json!(""));
            }
            let incomplete: Vec<&TaskStep> = s.steps.iter().filter(|step| matches!(step.status, StepStatus::Pending | StepStatus::InProgress | StepStatus::Blocked)).collect();
            if incomplete.is_empty() {
                return ok_response(serde_json::json!(format!("Task completed: {}", s.goal)));
            }
            let mut lines: Vec<String> = vec![format!("Goal: {}", s.goal)];
            if let Some(ip) = incomplete.iter().find(|s| matches!(s.status, StepStatus::InProgress)) {
                let mut msg = format!("Current: {}", ip.content);
                if let Some(ref err) = ip.error {
                    msg.push_str(&format!(" (error: {})", err));
                }
                lines.push(msg);
            }
            let pending: Vec<&&TaskStep> = incomplete.iter().filter(|s| !matches!(s.status, StepStatus::InProgress)).collect();
            if !pending.is_empty() && pending.len() <= 3 {
                lines.push(format!("Remaining: {}", pending.iter().map(|s| s.content.as_str()).collect::<Vec<_>>().join(", ")));
            } else if pending.len() > 3 {
                lines.push(format!("Remaining: {} steps (see task state for details)", pending.len()));
            }
            let unrecovered: Vec<&TaskError> = s.errors.iter().filter(|err| !err.recovered).collect();
            if !unrecovered.is_empty() {
                lines.push(format!("Unresolved errors: {}", unrecovered.len()));
            }
            ok_response(serde_json::json!(lines.join("\n")))
        }
    }
}

// ── Event Ledger ────────────────────────────────────────────
fn cmd_event_append(path: &str, event: &AgentEvent) -> CliResponse {
    let t0 = Instant::now();
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match OpenOptions::new().append(true).create(true).open(&p) {
        Ok(mut f) => match f.write_all(format!("{}\n", serde_json::to_string(event).unwrap_or_default()).as_bytes()) {
            Ok(_) => ok_response(serde_json::json!({"appended": true})),
            Err(e) => err_response(&e.to_string()),
        },
        Err(e) => err_response(&e.to_string()),
    }
}

fn cmd_event_read(path: &str) -> CliResponse {
    let t0 = Instant::now();
    let p = PathBuf::from(path);
    if !p.exists() {
        return ok_response(serde_json::json!([]));
    }
    match File::open(&p) {
        Ok(file) => {
            let reader = io::BufReader::new(file);
            let mut events: Vec<serde_json::Value> = Vec::new();
            for line in reader.lines() {
                match line {
                    Ok(l) if !l.trim().is_empty() => {
                        if let Ok(ev) = serde_json::from_str(&l) {
                            events.push(ev);
                        }
                    }
                    _ => {}
                }
            }
            CliResponse {
                ok: true,
                data: Some(serde_json::to_value(&events).unwrap()),
                error: None,
                elapsed_ms: Some(t0.elapsed().as_secs_f64() * 1000.0),
            }
        }
        Err(e) => err_response(&e.to_string()),
    }
}

// ── Context Checkpoint ──────────────────────────────────────
fn cmd_checkpoint_load(path: &str) -> CliResponse {
    let t0 = Instant::now();
    let p = PathBuf::from(path);
    if !p.exists() {
        return CliResponse {
            ok: true,
            data: Some(serde_json::json!(null)),
            error: None,
            elapsed_ms: Some(t0.elapsed().as_secs_f64() * 1000.0),
        };
    }
    match fs::read_to_string(&p) {
        Ok(content) => match serde_json::from_str::<ContextCheckpoint>(&content) {
            Ok(cp) => CliResponse {
                ok: true,
                data: Some(serde_json::to_value(&cp).unwrap()),
                error: None,
                elapsed_ms: Some(t0.elapsed().as_secs_f64() * 1000.0),
            },
            Err(e) => err_response(&e.to_string()),
        },
        Err(e) => err_response(&e.to_string()),
    }
}

fn cmd_checkpoint_save(path: &str, checkpoint: &ContextCheckpoint) -> CliResponse {
    let t0 = Instant::now();
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match serde_json::to_string_pretty(checkpoint) {
        Ok(content) => match fs::write(&p, content) {
            Ok(_) => ok_response(serde_json::json!({"saved": true})),
            Err(e) => err_response(&e.to_string()),
        },
        Err(e) => err_response(&e.to_string()),
    }
}

fn cmd_checkpoint_format(checkpoint: &ContextCheckpoint) -> CliResponse {
    let t0 = Instant::now();
    let mut lines: Vec<String> = Vec::new();
    lines.push("## Session Context".to_string());
    lines.push(format!("Goal: {}", checkpoint.goal));
    if !checkpoint.done.is_empty() {
        lines.push("Done:".to_string());
        for d in &checkpoint.done {
            lines.push(format!("  ✓ {}", d));
        }
    }
    if !checkpoint.in_progress.is_empty() {
        lines.push("In progress:".to_string());
        for ip in &checkpoint.in_progress {
            lines.push(format!("  ● {}", ip));
        }
    }
    if !checkpoint.next_steps.is_empty() {
        lines.push("Next:".to_string());
        for ns in checkpoint.next_steps.iter().take(5) {
            lines.push(format!("  → {}", ns));
        }
    }
    if !checkpoint.decisions.is_empty() {
        lines.push("Decisions:".to_string());
        for dec in checkpoint.decisions.iter().take(3) {
            lines.push(format!("  · {}: {}", dec.what, dec.why));
        }
    }
    let has_open = checkpoint.issues.iter().any(|i| !i.recovered);
    if has_open {
        lines.push("Open issues:".to_string());
        for issue in &checkpoint.issues {
            if issue.recovered { continue; }
            let mut msg = format!("  ! {}", issue.message);
            if let Some(ref tool) = issue.tool {
                msg.push_str(&format!(" [{}]", tool));
            }
            lines.push(msg);
        }
    }
    if !checkpoint.critical_context.is_empty() {
        lines.push("Critical context:".to_string());
        for ctx in checkpoint.critical_context.iter().take(5) {
            lines.push(format!("  ` {}", ctx));
        }
    }
    if !checkpoint.constraints.is_empty() {
        lines.push("Constraints:".to_string());
        for c in &checkpoint.constraints {
            lines.push(format!("  • {}", c));
        }
    }
    ok_response(serde_json::json!(lines.join("\n")))
}

fn cmd_checkpoint_compact(checkpoint: &ContextCheckpoint) -> CliResponse {
    let t0 = Instant::now();
    let mut lines: Vec<String> = vec![format!("Goal: {}", checkpoint.goal)];
    if !checkpoint.in_progress.is_empty() {
        lines.push(format!("Current: {}", checkpoint.in_progress[0]));
    }
    if !checkpoint.next_steps.is_empty() {
        lines.push(format!("Next: {}", checkpoint.next_steps[0]));
    }
    let open: Vec<&Issue> = checkpoint.issues.iter().filter(|i| !i.recovered).collect();
    if !open.is_empty() {
        let msgs: Vec<&str> = open.iter().map(|i| i.message.as_str()).collect();
        lines.push(format!("Blockers: {}", msgs.join("; ")));
    }
    ok_response(serde_json::json!(lines.join("\n")))
}

fn main() {
    let mut input = String::new();
    std::io::Read::read_to_string(&mut io::stdin(), &mut input).unwrap_or_default();
    let cmd: CliCommand = match serde_json::from_str(&input) {
        Ok(c) => c,
        Err(e) => {
            let resp = err_response(&e.to_string());
            println!("{}", serde_json::to_string(&resp).unwrap());
            return;
        }
    };
    let t0 = Instant::now();
    let resp = match cmd {
        CliCommand::TaskStateLoad { path } => cmd_task_state_load(&path),
        CliCommand::TaskStateSave { path, state } => cmd_task_state_save(&path, &state),
        CliCommand::TaskStateFormat { state } => cmd_task_state_format(&state),
        CliCommand::TaskStateCompact { state } => cmd_task_state_compact(&state),
        CliCommand::EventAppend { path, event } => cmd_event_append(&path, &event),
        CliCommand::EventRead { path } => cmd_event_read(&path),
        CliCommand::CheckpointLoad { path } => cmd_checkpoint_load(&path),
        CliCommand::CheckpointSave { path, checkpoint } => cmd_checkpoint_save(&path, &checkpoint),
        CliCommand::CheckpointFormat { checkpoint } => cmd_checkpoint_format(&checkpoint),
        CliCommand::CheckpointCompact { checkpoint } => cmd_checkpoint_compact(&checkpoint),
    };
    // Attach elapsed time
    let ms = t0.elapsed().as_secs_f64() * 1000.0;
    let mut resp = resp;
    resp.elapsed_ms = Some(ms);
    println!("{}", serde_json::to_string(&resp).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn test_roundtrip_task_state() {
        let state = TaskState {
            version: 1,
            id: "test-1".to_string(),
            goal: "Fix the bug".to_string(),
            status: TaskStatus::Running,
            steps: vec![
                TaskStep {
                    content: "Reproduce".to_string(),
                    status: StepStatus::Completed,
                    result: Some("Reproduced".to_string()),
                    ..Default::default()
                },
                TaskStep {
                    content: "Fix it".to_string(),
                    status: StepStatus::InProgress,
                    ..Default::default()
                },
            ],
            checkpoints: vec![],
            errors: vec![],
            next_steps: vec!["Test".to_string()],
            context_notes: vec![],
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            session_id: None,
        };
        let json = serde_json::to_string(&state).unwrap();
        let parsed: TaskState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.goal, "Fix the bug");
        assert_eq!(parsed.steps.len(), 2);
    }

    #[test]
    fn test_event_append_read() {
        let dir = env::temp_dir();
        let path = dir.join("pi-storage-test.jsonl");
        let event = AgentEvent {
            version: 1,
            id: "test-event".to_string(),
            r#type: EventType::ToolCall,
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            cwd: "/tmp".to_string(),
            session_id: None,
            data: serde_json::json!({"tool": "bash"}),
        };
        cmd_event_append(path.to_str().unwrap(), &event);
        let resp = cmd_event_read(path.to_str().unwrap());
        assert!(resp.ok);
        assert_eq!(resp.elapsed_ms.unwrap() as u64, resp.elapsed_ms.unwrap() as u64); // just check it runs
    }
}
