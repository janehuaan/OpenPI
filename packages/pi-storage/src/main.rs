//! pi-storage: Rust implementation of task state, event ledger, and context checkpoint.
//!
//! Two modes:
//!   - CLI (stdin/stdout JSON): for one-shot calls
//!   - Server (TCP): persistent process, low-latency queries

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

// ═══════════════════════════════════════════════════════════════
// Data Types (matching TS interfaces exactly)
// ═══════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus { Idle, Running, Paused, Completed, Failed }
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus { Pending, InProgress, Completed, Blocked }
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind { Verification, Review, Diff, Files, Manual }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskCheckpoint { pub index: usize, pub label: String, pub done: bool,
    #[serde(skip_serializing_if = "Option::is_none")] pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub error: Option<String>, }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskError { pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub stack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub tool: Option<String>,
    pub recovered: bool, pub created_at: String, }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct EvidenceItem { pub kind: EvidenceKind, pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub paths: Option<Vec<String>>, }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskStep { pub content: String, pub status: StepStatus,
    #[serde(skip_serializing_if = "Option::is_none")] pub active_form: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub evidence: Option<Vec<EvidenceItem>>,
    #[serde(skip_serializing_if = "Option::is_none")] pub error: Option<String>, }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskState { pub version: u32, pub id: String, pub goal: String, pub status: TaskStatus,
    pub steps: Vec<TaskStep>, pub checkpoints: Vec<TaskCheckpoint>, pub errors: Vec<TaskError>,
    pub next_steps: Vec<String>, pub context_notes: Vec<String>, pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub session_id: Option<String>, }

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum EventType { TaskStart, TaskStep, TaskComplete, TaskError, ToolCall, ToolResult,
    ToolError, CheckpointSave, Compaction, SessionStart, SessionEnd }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AgentEvent { pub version: u32, pub id: String, pub r#type: EventType,
    pub timestamp: String, pub cwd: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub session_id: Option<String>,
    pub data: serde_json::Value, }

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Decision { pub what: String, pub why: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub context: Option<String>, }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Issue { pub message: String, pub recovered: bool,
    #[serde(skip_serializing_if = "Option::is_none")] pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub note: Option<String>, }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ContextCheckpoint { pub version: u32, pub created_at: String, pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub session_id: Option<String>,
    pub goal: String, pub done: Vec<String>, pub in_progress: Vec<String>,
    pub next_steps: Vec<String>, pub decisions: Vec<Decision>, pub issues: Vec<Issue>,
    pub critical_context: Vec<String>, pub constraints: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub history_summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub estimated_tokens_remaining: Option<u32>, }

// ═══════════════════════════════════════════════════════════════
// CLI Response
// ═══════════════════════════════════════════════════════════════

#[derive(Serialize)]
struct CliResponse { ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")] data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")] error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] elapsed_ms: Option<f64>, }
impl CliResponse {
    fn ok(data: serde_json::Value) -> Self { CliResponse { ok: true, data: Some(data), error: None, elapsed_ms: None } }
    fn err(msg: &str) -> Self { CliResponse { ok: false, data: None, error: Some(msg.to_string()), elapsed_ms: None } }
    fn with_ms(mut self, ms: f64) -> Self { self.elapsed_ms = Some(ms); self }
}

// ═══════════════════════════════════════════════════════════════
// CLI Commands
// ═══════════════════════════════════════════════════════════════

#[derive(Deserialize)]
#[serde(tag = "cmd")]
enum CliCommand {
    #[serde(rename = "task_state_load")] TaskStateLoad { path: String },
    #[serde(rename = "task_state_save")] TaskStateSave { path: String, state: TaskState },
    #[serde(rename = "task_state_format")] TaskStateFormat { state: Option<TaskState> },
    #[serde(rename = "task_state_compact")] TaskStateCompact { state: Option<TaskState> },
    #[serde(rename = "event_append")] EventAppend { path: String, event: AgentEvent },
    #[serde(rename = "event_read")] EventRead { path: String },
    #[serde(rename = "checkpoint_load")] CheckpointLoad { path: String },
    #[serde(rename = "checkpoint_save")] CheckpointSave { path: String, checkpoint: ContextCheckpoint },
    #[serde(rename = "checkpoint_format")] CheckpointFormat { checkpoint: ContextCheckpoint },
    #[serde(rename = "checkpoint_compact")] CheckpointCompact { checkpoint: ContextCheckpoint },
    #[serde(rename = "bash_summarize")] BashSummarize { lines: Vec<String> },
    #[serde(rename = "build_summarization_prompt")] BuildPrompt { conversation_text: String, previous_summary: Option<String>, custom_instructions: Option<String> },
    #[serde(rename = "parse_json_from_text")] ParseJson { text: String },
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

fn now_iso() -> String { SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs_f64().to_string() }
fn ms(elapsed: std::time::Duration) -> f64 { elapsed.as_secs_f64() * 1000.0 }

// ═══════════════════════════════════════════════════════════════
// Task State Handlers
// ═══════════════════════════════════════════════════════════════

fn h_task_state_load(path: &str, t0: Instant) -> CliResponse {
    let p = PathBuf::from(path);
    if !p.exists() { return CliResponse::ok(serde_json::json!(null)).with_ms(ms(t0.elapsed())); }
    match fs::read_to_string(&p) {
        Ok(c) => match serde_json::from_str::<TaskState>(&c) {
            Ok(s) => CliResponse::ok(serde_json::to_value(&s).unwrap()).with_ms(ms(t0.elapsed())),
            Err(e) => CliResponse::err(&e.to_string()),
        },
        Err(e) => CliResponse::err(&e.to_string()),
    }
}
fn h_task_state_save(path: &str, state: &TaskState, t0: Instant) -> CliResponse {
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
    match serde_json::to_string_pretty(state) {
        Ok(c) => match fs::write(&p, c) { Ok(_) => CliResponse::ok(serde_json::json!({"saved": true})).with_ms(ms(t0.elapsed())), Err(e) => CliResponse::err(&e.to_string()) },
        Err(e) => CliResponse::err(&e.to_string()),
    }
}
fn h_task_state_format(state: &Option<TaskState>, t0: Instant) -> CliResponse {
    let mut lines: Vec<String> = Vec::new();
    match state {
        None => { /* empty */ }
        Some(s) => {
            lines.push(format!("Goal: {}", s.goal));
            lines.push(format!("Status: {:?}", s.status));
            lines.push(String::new());
            lines.push("Steps:".to_string());
            for step in &s.steps {
                let icon = match step.status { StepStatus::Completed => "✓", StepStatus::InProgress => "●", StepStatus::Blocked => "!", _ => "○" };
                lines.push(format!("  {} [{}] {}", icon, format!("{:?}", step.status).to_lowercase(), step.content));
                if let Some(ref e) = step.error { lines.push(format!("    Error: {}", e)); }
                if let Some(ref r) = step.result { lines.push(format!("    Result: {}", r)); }
            }
            if !s.checkpoints.is_empty() { lines.push(String::new()); lines.push("Checkpoints:".to_string()); for cp in &s.checkpoints { lines.push(format!("  {} {}", if cp.done {"✓"} else {"○"}, cp.label)); } }
            if !s.errors.is_empty() { lines.push(String::new()); lines.push("Errors:".to_string()); for e in s.errors.iter().rev().take(3) { lines.push(format!("  {} {}", if e.recovered {"↩"} else {"✗"}, &e.message[..e.message.chars().take(100).collect::<String>().len().min(100)])); } }
            if !s.next_steps.is_empty() { lines.push(String::new()); lines.push("Next:".to_string()); for ns in s.next_steps.iter().take(5) { lines.push(format!("  - {}", ns)); } }
            if !s.context_notes.is_empty() { lines.push(String::new()); lines.push("Context:".to_string()); for n in s.context_notes.iter().take(5) { lines.push(format!("  · {}", n)); } }
        }
    }
    CliResponse::ok(serde_json::json!(lines.join("\n"))).with_ms(ms(t0.elapsed()))
}
fn h_task_state_compact(state: &Option<TaskState>, t0: Instant) -> CliResponse {
    match state {
        None => CliResponse::ok(serde_json::json!("")).with_ms(ms(t0.elapsed())),
        Some(s) if s.steps.is_empty() => CliResponse::ok(serde_json::json!("")).with_ms(ms(t0.elapsed())),
        Some(s) => {
            let incomplete: Vec<&TaskStep> = s.steps.iter().filter(|st| matches!(st.status, StepStatus::Pending | StepStatus::InProgress | StepStatus::Blocked)).collect();
            if incomplete.is_empty() { return CliResponse::ok(serde_json::json!(format!("Task completed: {}", s.goal))).with_ms(ms(t0.elapsed())); }
            let mut lines = vec![format!("Goal: {}", s.goal)];
            if let Some(ip) = incomplete.iter().find(|s| matches!(s.status, StepStatus::InProgress)) {
                let mut m = format!("Current: {}", ip.content);
                if let Some(ref e) = ip.error { m.push_str(&format!(" (error: {})", e)); }
                lines.push(m);
            }
            let pending: Vec<&&TaskStep> = incomplete.iter().filter(|s| !matches!(s.status, StepStatus::InProgress)).collect();
            if !pending.is_empty() && pending.len() <= 3 { lines.push(format!("Remaining: {}", pending.iter().map(|s| s.content.as_str()).collect::<Vec<_>>().join(", "))); }
            else if !pending.is_empty() { lines.push(format!("Remaining: {} steps", pending.len())); }
            let unrecovered: Vec<&TaskError> = s.errors.iter().filter(|e| !e.recovered).collect();
            if !unrecovered.is_empty() { lines.push(format!("Unresolved errors: {}", unrecovered.len())); }
            CliResponse::ok(serde_json::json!(lines.join("\n"))).with_ms(ms(t0.elapsed()))
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// Event Ledger Handlers
// ═══════════════════════════════════════════════════════════════

fn h_event_append(path: &str, event: &AgentEvent, t0: Instant) -> CliResponse {
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
    match OpenOptions::new().append(true).create(true).open(&p) {
        Ok(mut f) => match f.write_all(format!("{}\n", serde_json::to_string(event).unwrap()).as_bytes()) {
            Ok(_) => CliResponse::ok(serde_json::json!({"appended": true})).with_ms(ms(t0.elapsed())),
            Err(e) => CliResponse::err(&e.to_string()),
        },
        Err(e) => CliResponse::err(&e.to_string()),
    }
}
fn h_event_read(path: &str, t0: Instant) -> CliResponse {
    let p = PathBuf::from(path);
    if !p.exists() { return CliResponse::ok(serde_json::json!([])).with_ms(ms(t0.elapsed())); }
    match File::open(&p) {
        Ok(file) => {
            let reader = io::BufReader::new(file);
            let events: Vec<serde_json::Value> = reader.lines().filter_map(|l| l.ok().and_then(|line| if line.trim().is_empty() { None } else { serde_json::from_str(&line).ok() })).collect();
            CliResponse::ok(serde_json::to_value(&events).unwrap()).with_ms(ms(t0.elapsed()))
        },
        Err(e) => CliResponse::err(&e.to_string()),
    }
}

// ═══════════════════════════════════════════════════════════════
// Checkpoint Handlers
// ═══════════════════════════════════════════════════════════════

fn h_checkpoint_load(path: &str, t0: Instant) -> CliResponse {
    let p = PathBuf::from(path);
    if !p.exists() { return CliResponse::ok(serde_json::json!(null)).with_ms(ms(t0.elapsed())); }
    match fs::read_to_string(&p) {
        Ok(c) => match serde_json::from_str::<ContextCheckpoint>(&c) {
            Ok(cp) => CliResponse::ok(serde_json::to_value(&cp).unwrap()).with_ms(ms(t0.elapsed())),
            Err(e) => CliResponse::err(&e.to_string()),
        },
        Err(e) => CliResponse::err(&e.to_string()),
    }
}
fn h_checkpoint_save(path: &str, cp: &ContextCheckpoint, t0: Instant) -> CliResponse {
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
    match serde_json::to_string_pretty(cp) {
        Ok(c) => match fs::write(&p, c) { Ok(_) => CliResponse::ok(serde_json::json!({"saved": true})).with_ms(ms(t0.elapsed())), Err(e) => CliResponse::err(&e.to_string()) },
        Err(e) => CliResponse::err(&e.to_string()),
    }
}
fn h_checkpoint_format(cp: &ContextCheckpoint, t0: Instant) -> CliResponse {
    let mut lines: Vec<String> = Vec::new();
    lines.push("## Session Context".to_string());
    lines.push(format!("Goal: {}", cp.goal));
    if !cp.done.is_empty() { lines.push("Done:".to_string()); for d in &cp.done { lines.push(format!("  ✓ {}", d)); } }
    if !cp.in_progress.is_empty() { lines.push("In progress:".to_string()); for ip in &cp.in_progress { lines.push(format!("  ● {}", ip)); } }
    if !cp.next_steps.is_empty() { lines.push("Next:".to_string()); for ns in cp.next_steps.iter().take(5) { lines.push(format!("  → {}", ns)); } }
    if !cp.decisions.is_empty() { lines.push("Decisions:".to_string()); for d in cp.decisions.iter().take(3) { lines.push(format!("  · {}: {}", d.what, d.why)); } }
    if cp.issues.iter().any(|i| !i.recovered) { lines.push("Open issues:".to_string()); for i in &cp.issues { if i.recovered { continue; } let mut m = format!("  ! {}", i.message); if let Some(ref t) = i.tool { m.push_str(&format!(" [{}]", t)); } lines.push(m); } }
    if !cp.critical_context.is_empty() { lines.push("Critical context:".to_string()); for c in cp.critical_context.iter().take(5) { lines.push(format!("  ` {}", c)); } }
    if !cp.constraints.is_empty() { lines.push("Constraints:".to_string()); for c in &cp.constraints { lines.push(format!("  • {}", c)); } }
    CliResponse::ok(serde_json::json!(lines.join("\n"))).with_ms(ms(t0.elapsed()))
}
fn h_checkpoint_compact(cp: &ContextCheckpoint, t0: Instant) -> CliResponse {
    let mut lines = vec![format!("Goal: {}", cp.goal)];
    if !cp.in_progress.is_empty() { lines.push(format!("Current: {}", cp.in_progress[0])); }
    if !cp.next_steps.is_empty() { lines.push(format!("Next: {}", cp.next_steps[0])); }
    let open: Vec<&Issue> = cp.issues.iter().filter(|i| !i.recovered).collect();
    if !open.is_empty() { lines.push(format!("Blockers: {}", open.iter().map(|i| i.message.as_str()).collect::<Vec<_>>().join("; "))); }
    CliResponse::ok(serde_json::json!(lines.join("\n"))).with_ms(ms(t0.elapsed()))
}

// ═══════════════════════════════════════════════════════════════
// Bash Summarizer
// ═══════════════════════════════════════════════════════════════

fn h_bash_summarize(lines: &[String], t0: Instant) -> CliResponse {
    let error_re = Regex::new(r"(?i)(?:error|fail|exception|abort|fatal|undefinedvariable)").unwrap();
    let warn_re = Regex::new(r"(?i)(?:warn|deprecated|notice)").unwrap();
    let summary_re = Regex::new(r"^[\s]*[✓✔✗✘×]").unwrap();
    let bullet_re = Regex::new(r"^\s*[-*] ").unwrap();

    let errors: Vec<&str> = lines.iter().filter(|l| error_re.is_match(l)).map(|l| l.as_str()).rev().take(10).collect();
    let warnings: Vec<&str> = lines.iter().filter(|l| warn_re.is_match(l)).map(|l| l.as_str()).rev().take(5).collect();
    let summary_lines: Vec<&str> = lines.iter().filter(|l| summary_re.is_match(l) || bullet_re.is_match(l)).map(|l| l.as_str()).rev().take(10).collect();

    let mut parts: Vec<String> = Vec::new();
    if !errors.is_empty() {
        parts.push(format!("Errors ({}):", errors.len()));
        for e in &errors { parts.push(format!("  {}", e.trim().chars().take(200).collect::<String>())); }
    }
    if !warnings.is_empty() {
        parts.push(format!("Warnings ({}):", warnings.len()));
        for w in &warnings { parts.push(format!("  {}", w.trim().chars().take(200).collect::<String>())); }
    }
    if !summary_lines.is_empty() && errors.is_empty() && warnings.is_empty() {
        parts.push("Key lines:".to_string());
        for s in &summary_lines { parts.push(format!("  {}", s.trim().chars().take(200).collect::<String>())); }
    }
    if parts.is_empty() {
        let head: Vec<String> = lines.iter().take(5).map(|l| l.trim().to_string()).filter(|s| !s.is_empty()).collect();
        let tail: Vec<String> = lines.iter().rev().take(5).map(|l| l.trim().to_string()).filter(|s| !s.is_empty()).collect();
        let mut seen = HashSet::new();
        let unique: Vec<String> = head.into_iter().chain(tail.into_iter()).filter(|s| seen.insert(s.clone())).collect();
        let result = if unique.is_empty() { "(large output, no key lines found)".to_string() } else { unique.join("\n") }; return CliResponse::ok(serde_json::json!(result)).with_ms(ms(t0.elapsed()));
    }
    CliResponse::ok(serde_json::json!(parts.join("\n"))).with_ms(ms(t0.elapsed()))
}

// ═══════════════════════════════════════════════════════════════
// Prompt Builder
// ═══════════════════════════════════════════════════════════════

fn h_build_prompt(conv: &str, prev: &Option<String>, custom: &Option<String>, t0: Instant) -> CliResponse {
    let base = include_str!("../assets/update_summarization_prompt.txt");
    let base = if prev.is_none() { include_str!("../assets/summarization_prompt.txt") } else { base };
    let mut prompt = format!("<conversation>\n{}\n</conversation>\n\n", conv);
    if let Some(ref s) = prev { prompt.push_str(&format!("<previous-summary>\n{}\n</previous-summary>\n\n", s)); }
    prompt.push_str(base);
    if let Some(ref i) = custom { prompt.push_str(&format!("\n\nAdditional focus: {}", i)); }
    CliResponse::ok(serde_json::json!({"prompt": prompt})).with_ms(ms(t0.elapsed()))
}

fn h_parse_json(text: &str, t0: Instant) -> CliResponse {
    match text.find('{') {
        Some(start) => match text.rfind('}') {
            Some(end) if end >= start => {
                let json_str = &text[start..=end];
                match serde_json::from_str::<serde_json::Value>(json_str) {
                    Ok(v) if v.get("goal").is_some() => CliResponse::ok(serde_json::json!({"json": json_str})).with_ms(ms(t0.elapsed())),
                    Ok(_) | Err(_) => CliResponse::ok(serde_json::json!(null)).with_ms(ms(t0.elapsed())),
                }
            },
            _ => CliResponse::ok(serde_json::json!(null)).with_ms(ms(t0.elapsed())),
        },
        None => CliResponse::ok(serde_json::json!(null)).with_ms(ms(t0.elapsed())),
    }
}

// ═══════════════════════════════════════════════════════════════
// CLI Mode
// ═══════════════════════════════════════════════════════════════

fn run_cli() {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap_or_default();
    let cmd: CliCommand = match serde_json::from_str(&input) {
        Ok(c) => c, Err(e) => { println!("{}", serde_json::to_string(&CliResponse::err(&e.to_string())).unwrap()); return; }
    };
    let t0 = Instant::now();
    let resp = match cmd {
        CliCommand::TaskStateLoad { path } => h_task_state_load(&path, t0),
        CliCommand::TaskStateSave { path, state } => h_task_state_save(&path, &state, t0),
        CliCommand::TaskStateFormat { state } => h_task_state_format(&state, t0),
        CliCommand::TaskStateCompact { state } => h_task_state_compact(&state, t0),
        CliCommand::EventAppend { path, event } => h_event_append(&path, &event, t0),
        CliCommand::EventRead { path } => h_event_read(&path, t0),
        CliCommand::CheckpointLoad { path } => h_checkpoint_load(&path, t0),
        CliCommand::CheckpointSave { path, checkpoint } => h_checkpoint_save(&path, &checkpoint, t0),
        CliCommand::CheckpointFormat { checkpoint } => h_checkpoint_format(&checkpoint, t0),
        CliCommand::CheckpointCompact { checkpoint } => h_checkpoint_compact(&checkpoint, t0),
        CliCommand::BashSummarize { lines } => h_bash_summarize(&lines, t0),
        CliCommand::BuildPrompt { conversation_text, previous_summary, custom_instructions } => h_build_prompt(&conversation_text, &previous_summary, &custom_instructions, t0),
        CliCommand::ParseJson { text } => h_parse_json(&text, t0),
    };
    println!("{}", serde_json::to_string(&resp).unwrap());
}

// ═══════════════════════════════════════════════════════════════
// Server Mode
// ═══════════════════════════════════════════════════════════════

#[derive(Deserialize)]
struct ServerCmd { cmd: String, #[serde(flatten)] args: serde_json::Value }
#[derive(Serialize)]
struct ServerResp { ok: bool, #[serde(skip_serializing_if = "Option::is_none")] data: Option<serde_json::Value>, #[serde(skip_serializing_if = "Option::is_none")] error: Option<String>, elapsed_ms: f64 }

fn handle_client(mut stream: TcpStream) {
    let mut buf = [0u8; 65536];
    let n = match stream.read(&mut buf) { Ok(n) => n, Err(_) => return };
    let cmd: ServerCmd = match serde_json::from_slice(&buf[..n]) { Ok(c) => c, Err(e) => {
        let resp = ServerResp { ok: false, data: None, error: Some(e.to_string()), elapsed_ms: 0.0 };
        let _ = stream.write_all(format!("{}\n", serde_json::to_string(&resp).unwrap()).as_bytes());
        return;
    }};
    let t0 = Instant::now();
    let resp = match cmd.cmd.as_str() {
        "ping" => ServerResp { ok: true, data: Some(serde_json::json!({"pong": true})), error: None, elapsed_ms: ms(t0.elapsed()) },
        _ => ServerResp { ok: false, data: None, error: Some(format!("Unknown command: {}", cmd.cmd)), elapsed_ms: ms(t0.elapsed()) },
    };
    let _ = stream.write_all(format!("{}\n", serde_json::to_string(&resp).unwrap()).as_bytes());
}

fn run_server(port: u16) {
    let listener = TcpListener::bind(format!("127.0.0.1:{}", port)).expect("bind failed");
    eprintln!("pi-storage server listening on port {}", port);
    for stream in listener.incoming() {
        if let Ok(s) = stream { std::thread::spawn(|| handle_client(s)); }
    }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "--server" {
        let mut port = 8766u16;
        let mut i = 2;
        while i < args.len() { if args[i] == "--port" { i += 1; port = args[i].parse().unwrap_or(8766); } i += 1; }
        run_server(port);
    } else {
        run_cli();
    }
}
