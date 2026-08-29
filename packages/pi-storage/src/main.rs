//! pi-storage: Rust implementation of task state, event ledger, checkpoint, fuzzy search, and JSONL ops.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;
use std::time::Instant;

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus { Idle, Running, Paused, Completed, Failed }
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus { Pending, InProgress, Completed, Blocked }

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
pub struct TaskStep { pub content: String, pub status: StepStatus,
    #[serde(skip_serializing_if = "Option::is_none")] pub active_form: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub error: Option<String>, }
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TaskState { pub version: u32, pub id: String, pub goal: String, pub status: TaskStatus,
    pub steps: Vec<TaskStep>, pub checkpoints: Vec<TaskCheckpoint>, pub errors: Vec<TaskError>,
    pub next_steps: Vec<String>, pub context_notes: Vec<String>, pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")] pub session_id: Option<String>, }

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum EventType { TaskStart, TaskStep, TaskComplete, ToolCall, ToolResult, Compaction }
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
    #[serde(skip_serializing_if = "Option::is_none")] pub history_summary: Option<String>, }

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
    #[serde(rename = "fuzzy_match")] FuzzyMatch { query: String, text: String },
    #[serde(rename = "jsonl_read")] JsonlRead { path: String },
    #[serde(rename = "jsonl_append")] JsonlAppend { path: String, value: serde_json::Value },
    #[serde(rename = "jsonl_write")] JsonlWrite { path: String, values: Vec<serde_json::Value> },
}

// ═══════════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════════

fn ms(d: std::time::Duration) -> f64 { d.as_secs_f64() * 1000.0 }

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
                let icon = match step.status { StepStatus::Completed => "✓", StepStatus::InProgress => "●", _ => "○" };
                lines.push(format!("  {} [{}] {}", icon, format!("{:?}", step.status).to_lowercase(), step.content));
                if let Some(ref e) = step.error { lines.push(format!("    Error: {}", e)); }
            }
            if !s.next_steps.is_empty() { lines.push(String::new()); lines.push("Next:".to_string()); for ns in s.next_steps.iter().take(5) { lines.push(format!("  - {}", ns)); } }
        }
    }
    CliResponse::ok(serde_json::json!(lines.join("\n"))).with_ms(ms(t0.elapsed()))
}
fn h_task_state_compact(state: &Option<TaskState>, t0: Instant) -> CliResponse {
    match state {
        None => CliResponse::ok(serde_json::json!("")).with_ms(ms(t0.elapsed())),
        Some(s) if s.steps.is_empty() => CliResponse::ok(serde_json::json!("")).with_ms(ms(t0.elapsed())),
        Some(s) => {
            let incomplete: Vec<&TaskStep> = s.steps.iter().filter(|st| matches!(st.status, StepStatus::Pending | StepStatus::InProgress)).collect();
            if incomplete.is_empty() { return CliResponse::ok(serde_json::json!(format!("Task completed: {}", s.goal))).with_ms(ms(t0.elapsed())); }
            let mut lines = vec![format!("Goal: {}", s.goal)];
            if let Some(ip) = incomplete.iter().find(|s| matches!(s.status, StepStatus::InProgress)) {
                lines.push(format!("Current: {}", ip.content));
            }
            CliResponse::ok(serde_json::json!(lines.join("\n"))).with_ms(ms(t0.elapsed()))
        }
    }
}
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
    if !cp.in_progress.is_empty() { lines.push(format!("Current: {}", cp.in_progress[0])); }
    if !cp.next_steps.is_empty() { lines.push(format!("Next: {}", cp.next_steps[0])); }
    CliResponse::ok(serde_json::json!(lines.join("\n"))).with_ms(ms(t0.elapsed()))
}
fn h_checkpoint_compact(cp: &ContextCheckpoint, t0: Instant) -> CliResponse {
    let mut lines = vec![format!("Goal: {}", cp.goal)];
    if !cp.in_progress.is_empty() { lines.push(format!("Current: {}", cp.in_progress[0])); }
    if !cp.next_steps.is_empty() { lines.push(format!("Next: {}", cp.next_steps[0])); }
    CliResponse::ok(serde_json::json!(lines.join("\n"))).with_ms(ms(t0.elapsed()))
}
fn h_bash_summarize(lines: &[String], t0: Instant) -> CliResponse {
    let error_re = Regex::new(r"(?i)(?:error|fail|exception|abort|fatal)").unwrap();
    let warn_re = Regex::new(r"(?i)(?:warn|deprecated|notice)").unwrap();
    let errors: Vec<&str> = lines.iter().filter(|l| error_re.is_match(l)).map(|l| l.as_str()).rev().take(10).collect();
    let warnings: Vec<&str> = lines.iter().filter(|l| warn_re.is_match(l)).map(|l| l.as_str()).rev().take(5).collect();
    let mut parts: Vec<String> = Vec::new();
    if !errors.is_empty() { parts.push(format!("Errors ({}):", errors.len())); for e in &errors { parts.push(format!("  {}", e.trim().chars().take(200).collect::<String>())); } }
    if !warnings.is_empty() { parts.push(format!("Warnings ({}):", warnings.len())); for w in &warnings { parts.push(format!("  {}", w.trim().chars().take(200).collect::<String>())); } }
    if parts.is_empty() {
        let head: Vec<String> = lines.iter().take(5).map(|l| l.trim().to_string()).filter(|s| !s.is_empty()).collect();
        let tail: Vec<String> = lines.iter().rev().take(5).map(|l| l.trim().to_string()).filter(|s| !s.is_empty()).collect();
        let unique: Vec<String> = head.into_iter().chain(tail.into_iter()).collect();
        let result = if unique.is_empty() { "(large output)".to_string() } else { unique.join("\n") }; return CliResponse::ok(serde_json::json!(result)).with_ms(ms(t0.elapsed()));
    }
    CliResponse::ok(serde_json::json!(parts.join("\n"))).with_ms(ms(t0.elapsed()))
}
fn h_build_prompt(conv: &str, prev: &Option<String>, custom: &Option<String>, t0: Instant) -> CliResponse {
    let base = if prev.is_none() { include_str!("../assets/summarization_prompt.txt") } else { include_str!("../assets/update_summarization_prompt.txt") };
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
                    _ => CliResponse::ok(serde_json::json!(null)).with_ms(ms(t0.elapsed())),
                }
            },
            _ => CliResponse::ok(serde_json::json!(null)).with_ms(ms(t0.elapsed())),
        },
        None => CliResponse::ok(serde_json::json!(null)).with_ms(ms(t0.elapsed())),
    }
}

// Fuzzy matching
fn fuzzy_match(query: &str, text: &str) -> (bool, f64) {
    let q = query.to_lowercase();
    let t = text.to_lowercase();
    if q.is_empty() { return (true, 0.0); }
    if q.len() > t.len() { return (false, 0.0); }
    let q_chars: Vec<char> = q.chars().collect();
    let t_chars: Vec<char> = t.chars().collect();
    let mut qi = 0;
    let mut score = 0.0;
    let mut last = usize::MAX;
    for (i, &tc) in t_chars.iter().enumerate() {
        if qi >= q_chars.len() { break; }
        if tc == q_chars[qi] {
            let is_boundary = i == 0 || " \t\n\\-_.:/".contains(t_chars[i - 1]);
            if last == i - 1 { score -= 5.0; }
            else { if last != usize::MAX { score += ((i - last - 1) as f64) * 2.0; } }
            if is_boundary { score -= 10.0; }
            score += (i as f64) * 0.1;
            last = i;
            qi += 1;
        }
    }
    if qi < q_chars.len() { return (false, 0.0); }
    if q == t { score -= 100.0; }
    (true, score)
}
fn h_fuzzy_match(query: &str, text: &str, t0: Instant) -> CliResponse {
    let (matches, score) = fuzzy_match(query, text);
    CliResponse::ok(serde_json::json!({"matches": matches, "score": score})).with_ms(ms(t0.elapsed()))
}

// JSONL operations
fn h_jsonl_read(path: &str, t0: Instant) -> CliResponse {
    let p = PathBuf::from(path);
    if !p.exists() { return CliResponse::ok(serde_json::json!([])).with_ms(ms(t0.elapsed())); }
    match File::open(&p) {
        Ok(file) => {
            let reader = io::BufReader::new(file);
            let lines: Vec<serde_json::Value> = reader.lines().filter_map(|l| l.ok().and_then(|line| if line.trim().is_empty() { None } else { serde_json::from_str(&line).ok() })).collect();
            CliResponse::ok(serde_json::to_value(&lines).unwrap()).with_ms(ms(t0.elapsed()))
        },
        Err(e) => CliResponse::err(&e.to_string()),
    }
}
fn h_jsonl_append(path: &str, value: &serde_json::Value, t0: Instant) -> CliResponse {
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
    match OpenOptions::new().append(true).create(true).open(&p) {
        Ok(mut f) => match f.write_all(format!("{}\n", serde_json::to_string(value).unwrap()).as_bytes()) {
            Ok(_) => CliResponse::ok(serde_json::json!({"appended": true})).with_ms(ms(t0.elapsed())),
            Err(e) => CliResponse::err(&e.to_string()),
        },
        Err(e) => CliResponse::err(&e.to_string()),
    }
}
fn h_jsonl_write(path: &str, values: &[serde_json::Value], t0: Instant) -> CliResponse {
    let p = PathBuf::from(path);
    if let Some(parent) = p.parent() { let _ = fs::create_dir_all(parent); }
    let content: String = values.iter().map(|v| serde_json::to_string(v).unwrap()).collect::<Vec<_>>().join("\n");
    match fs::write(&p, format!("{}\n", content)) {
        Ok(_) => CliResponse::ok(serde_json::json!({"written": values.len()})).with_ms(ms(t0.elapsed())),
        Err(e) => CliResponse::err(&e.to_string()),
    }
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

fn run_cli() {
    let mut input = String::new();
    io::stdin().read_to_string(&mut input).unwrap_or_default();
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
        CliCommand::FuzzyMatch { query, text } => h_fuzzy_match(&query, &text, t0),
        CliCommand::JsonlRead { path } => h_jsonl_read(&path, t0),
        CliCommand::JsonlAppend { path, value } => h_jsonl_append(&path, &value, t0),
        CliCommand::JsonlWrite { path, values } => h_jsonl_write(&path, &values, t0),
    };
    println!("{}", serde_json::to_string(&resp).unwrap());
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 && args[1] == "--server" {
        // Server mode placeholder
        eprintln!("Server mode not yet implemented");
        std::process::exit(1);
    } else {
        run_cli();
    }
}
