use anyhow::Result;
use chrono::Utc;
use serde_json::{json, Value};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use uuid::Uuid;

use crate::config::sessions_dir;
use crate::protocol::{ChatMessage, FunctionCall, ToolCall};

/// Global character budget for one request (~48,000 chars ~ 12,000 tokens).
const MAX_TOTAL_CHARS: usize = 48_000;
/// Never shrink a payload below this; it stops the halving loop from spinning.
const HARD_TOOL_FLOOR: usize = 400;
/// String values in tool-call arguments longer than this are folded away.
const ARG_STRING_KEEP: usize = 400;

/// Characters a message carries: `content`, tool-call arguments, and reasoning.
///
/// The budget used to count only `content`. A `write` call's file body lives in
/// `tool_calls[].function.arguments`, so it was invisible to every limit: one
/// real session accumulated 270,723 characters of assistant messages that way,
/// which is what pushed its requests to 78k tokens. `reasoning_content` was
/// invisible for the same reason and reached 98,143 characters in one turn.
fn message_chars(m: &ChatMessage) -> usize {
    let content = match &m.content {
        Some(crate::protocol::ChatContent::Text(t)) => t.chars().count(),
        _ => 0,
    };
    let args: usize = m
        .tool_calls
        .as_ref()
        .map(|calls| calls.iter().map(|c| c.function.arguments.chars().count()).sum())
        .unwrap_or(0);
    let reasoning = m.reasoning_content.as_ref().map_or(0, |r| r.chars().count());
    content + args + reasoning
}

/// Length of the longest single string value inside a JSON document.
fn longest_string_len(raw: &str) -> usize {
    fn walk(v: &Value) -> usize {
        match v {
            Value::String(s) => s.chars().count(),
            Value::Array(a) => a.iter().map(walk).max().unwrap_or(0),
            Value::Object(o) => o.values().map(walk).max().unwrap_or(0),
            _ => 0,
        }
    }
    serde_json::from_str::<Value>(raw).map(|v| walk(&v)).unwrap_or(0)
}

/// Replace every over-long string value in a tool call's JSON arguments with a
/// short marker. The JSON stays valid — providers reject malformed arguments —
/// and the small fields (`path`, `name`) survive, so the model still sees *what*
/// it did, just not the payload. Returns `None` when nothing needed shrinking.
pub(crate) fn shrink_arguments(raw: &str, max_string_chars: usize) -> Option<String> {
    fn shrink(v: &mut Value, max: usize) -> bool {
        match v {
            Value::String(s) if s.chars().count() > max => {
                let n = s.chars().count();
                *s = format!("[已省略 {n} 字符，完整内容见会话记录]");
                true
            }
            Value::Array(a) => a.iter_mut().fold(false, |hit, x| shrink(x, max) | hit),
            Value::Object(o) => o.values_mut().fold(false, |hit, x| shrink(x, max) | hit),
            _ => false,
        }
    }
    let mut v: Value = serde_json::from_str(raw).ok()?;
    if shrink(&mut v, max_string_chars) {
        serde_json::to_string(&v).ok()
    } else {
        None
    }
}

/// Fold the oversized string values of one message's tool calls in place.
pub(crate) fn shrink_message_arguments(m: &mut ChatMessage, max_string_chars: usize) -> bool {
    let Some(calls) = m.tool_calls.as_mut() else {
        return false;
    };
    let mut changed = false;
    for call in calls.iter_mut() {
        if call.function.arguments.chars().count() <= max_string_chars {
            continue;
        }
        if let Some(smaller) = shrink_arguments(&call.function.arguments, max_string_chars) {
            call.function.arguments = smaller;
            changed = true;
        }
    }
    changed
}

/// Fold an oversized `reasoning_content` down to a marker.
///
/// Reasoning is real request payload: the provider receives every character of
/// it on each call. It is kept for the recent steps (reasoning models expect it
/// echoed back) but older scratchpad is pure overhead — one measured turn held
/// 98,143 characters of it. The marker keeps the field present, so a provider
/// that wants it still sees *that* there was reasoning, just not the text.
pub(crate) fn shrink_message_reasoning(m: &mut ChatMessage, max_chars: usize) -> bool {
    let Some(r) = m.reasoning_content.as_ref() else {
        return false;
    };
    let n = r.chars().count();
    if n <= max_chars {
        return false;
    }
    m.reasoning_content = Some(format!("[已省略 {n} 字符的思考内容以节省上下文]"));
    true
}

#[derive(Clone, Copy)]
enum PayloadKind {
    Result,
    Arguments,
    Reasoning,
}

/// One step of budget reduction: shrink the single largest payload, whether it
/// is a tool-result body, a string inside a tool call's arguments, or a block of
/// reasoning. Returns false when there is nothing left worth shrinking.
fn shrink_largest_payload(messages: &mut [ChatMessage]) -> bool {
    let mut worst_result: Option<(usize, usize)> = None;
    let mut worst_arg: Option<(usize, usize)> = None;
    let mut worst_reasoning: Option<(usize, usize)> = None;
    for (i, m) in messages.iter().enumerate() {
        if m.role == "tool" {
            if let Some(crate::protocol::ChatContent::Text(t)) = &m.content {
                let n = t.chars().count();
                if n > HARD_TOOL_FLOOR * 2 && worst_result.is_none_or(|(_, w)| n > w) {
                    worst_result = Some((i, n));
                }
            }
        }
        if let Some(calls) = &m.tool_calls {
            for c in calls {
                let n = longest_string_len(&c.function.arguments);
                if n > ARG_STRING_KEEP * 2 && worst_arg.is_none_or(|(_, w)| n > w) {
                    worst_arg = Some((i, n));
                }
            }
        }
        if let Some(r) = &m.reasoning_content {
            let n = r.chars().count();
            if n > ARG_STRING_KEEP * 2 && worst_reasoning.is_none_or(|(_, w)| n > w) {
                worst_reasoning = Some((i, n));
            }
        }
    }

    let worst = [
        worst_result.map(|(i, n)| (i, n, PayloadKind::Result)),
        worst_arg.map(|(i, n)| (i, n, PayloadKind::Arguments)),
        worst_reasoning.map(|(i, n)| (i, n, PayloadKind::Reasoning)),
    ]
    .into_iter()
    .flatten()
    .max_by_key(|&(_, n, _)| n);

    match worst {
        None => false,
        // Arguments and reasoning fold outright, which frees the whole payload
        // in one step instead of halving repeatedly.
        Some((idx, _, PayloadKind::Arguments)) => {
            shrink_message_arguments(&mut messages[idx], ARG_STRING_KEEP)
        }
        Some((idx, _, PayloadKind::Reasoning)) => {
            shrink_message_reasoning(&mut messages[idx], ARG_STRING_KEEP)
        }
        Some((idx, len, PayloadKind::Result)) => {
            let target = (len / 2).max(HARD_TOOL_FLOOR);
            if let Some(crate::protocol::ChatContent::Text(ref mut t)) = messages[idx].content {
                let total = t.chars().count();
                let head = (target * 3) / 4;
                let tail = target.saturating_sub(head);
                let head_s: String = t.chars().take(head).collect();
                let tail_s: String = t.chars().skip(total.saturating_sub(tail)).collect();
                *t = format!(
                    "{}\n... [历史工具执行结果已自动截断，已省略 {} 字符以节省上下文] ...\n{}",
                    head_s,
                    total.saturating_sub(head + tail),
                    tail_s
                );
            }
            true
        }
    }
}

pub struct SessionJournal {
    pub session_id: String,
    pub file_path: PathBuf,
    pub last_entry_id: Option<String>,
}

impl SessionJournal {
    pub fn open(session_id: &str) -> Self {
        let dir = sessions_dir();
        let _ = create_dir_all(&dir);
        let file_path = dir.join(format!("{}.jsonl", session_id));

        let mut last_id = None;
        if file_path.exists() {
            if let Ok(content) = std::fs::read_to_string(&file_path) {
                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
                        if let Some(id) = val.get("id").and_then(|v| v.as_str()) {
                            last_id = Some(id.to_string());
                        }
                    }
                }
            }
        }

        Self {
            session_id: session_id.to_string(),
            file_path,
            last_entry_id: last_id,
        }
    }

    pub fn prune_history_messages(mut raw_messages: Vec<ChatMessage>, max_turns: usize) -> Vec<ChatMessage> {
        if raw_messages.is_empty() {
            return raw_messages;
        }

        // 1. Identify turn boundaries (indices where role == "user")
        let user_indices: Vec<usize> = raw_messages
            .iter()
            .enumerate()
            .filter(|(_, m)| m.role == "user")
            .map(|(i, _)| i)
            .collect();

        let num_user_turns = user_indices.len();
        if num_user_turns == 0 {
            return raw_messages;
        }

        // 2. Slice to the most recent `max_turns` (default 5 turns)
        let retained_start = if num_user_turns > max_turns {
            user_indices[num_user_turns - max_turns]
        } else {
            0
        };

        let mut sliced: Vec<ChatMessage> = raw_messages.drain(retained_start..).collect();

        // 3. Compact older toolResult outputs
        // Identify the last user turn index in `sliced`
        let sliced_user_indices: Vec<usize> = sliced
            .iter()
            .enumerate()
            .filter(|(_, m)| m.role == "user")
            .map(|(i, _)| i)
            .collect();

        let last_user_turn_idx = sliced_user_indices.last().copied().unwrap_or(0);

        for (idx, msg) in sliced.iter_mut().enumerate() {
            if msg.role == "tool" {
                if let Some(crate::protocol::ChatContent::Text(ref mut txt)) = msg.content {
                    let total_chars = txt.chars().count();
                    // Tools from older turns: aggressively truncate to ~400 chars if > 600 chars
                    if idx < last_user_turn_idx {
                        if total_chars > 600 {
                            let head: String = txt.chars().take(250).collect();
                            let tail: String = txt.chars().skip(total_chars.saturating_sub(150)).collect();
                            *txt = format!(
                                "{}\n... [历史工具执行结果已自动截断，已省略 {} 字符以节省上下文] ...\n{}",
                                head,
                                total_chars.saturating_sub(400),
                                tail
                            );
                        }
                    } else {
                        // Even in the most recent turn from history, cap massive outputs (> 3,500 chars)
                        if total_chars > 3500 {
                            let head: String = txt.chars().take(1500).collect();
                            let tail: String = txt.chars().skip(total_chars.saturating_sub(600)).collect();
                            *txt = format!(
                                "{}\n... [单步执行结果过大已保护性截断，已省略 {} 字符] ...\n{}",
                                head,
                                total_chars.saturating_sub(2100),
                                tail
                            );
                        }
                    }
                }
            }
        }

        // 3b. Fold older tool-call arguments and reasoning. A `write` call carries
        // the whole file body in its arguments, and nothing above counted it — one
        // session held 270,723 characters of these. Keep the newest turn intact so
        // the model can still reason about what it is doing right now.
        for (idx, msg) in sliced.iter_mut().enumerate() {
            if idx >= last_user_turn_idx {
                break;
            }
            shrink_message_arguments(msg, ARG_STRING_KEEP);
            shrink_message_reasoning(msg, ARG_STRING_KEEP);
        }

        // 4. Global character budget enforcement, over content *and* arguments.
        fn total_chars(messages: &[ChatMessage]) -> usize {
            messages.iter().map(message_chars).sum()
        }

        // 4a. Drop the oldest complete turns until within budget, keeping at least
        // the newest turn.
        loop {
            if total_chars(&sliced) <= MAX_TOTAL_CHARS {
                break;
            }
            let u_indices: Vec<usize> = sliced
                .iter()
                .enumerate()
                .filter(|(_, m)| m.role == "user")
                .map(|(i, _)| i)
                .collect();
            if u_indices.len() <= 1 {
                break;
            }
            sliced.drain(0..u_indices[1]);
        }

        // 4b. A single turn can still exceed the budget on its own: a tool-heavy
        // turn kept every result bounded only per-message (step 3 above), so dozens
        // of results could carry hundreds of KB into the next request. That leaked
        // past the budget — real calls were observed at 25k-42k tokens. Repeatedly
        // halve the largest remaining tool result until we fit, or every result
        // reaches the hard floor.
        loop {
            let before = total_chars(&sliced);
            if before <= MAX_TOTAL_CHARS {
                break;
            }
            if !shrink_largest_payload(&mut sliced) {
                break;
            }
            // Defensive: never spin if a step somehow failed to free anything.
            if total_chars(&sliced) >= before {
                break;
            }
        }

        sliced
    }

    pub fn load_history_messages(&self) -> Vec<ChatMessage> {
        let raw = self.load_raw_history_messages();
        Self::prune_history_messages(raw, 5)
    }

    pub fn load_raw_history_messages(&self) -> Vec<ChatMessage> {
        let mut messages = Vec::new();
        if !self.file_path.exists() {
            return messages;
        }

        let content = match std::fs::read_to_string(&self.file_path) {
            Ok(c) => c,
            Err(_) => return messages,
        };

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            let entry: Value = match serde_json::from_str(trimmed) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let entry_type = entry.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if entry_type != "message" {
                continue;
            }

            let msg = match entry.get("message") {
                Some(m) => m,
                None => continue,
            };

            let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");

            match role {
                "user" => {
                    let mut text_parts = Vec::new();
                    if let Some(contents) = msg.get("content").and_then(|c| c.as_array()) {
                        for c in contents {
                            if c.get("type").and_then(|t| t.as_str()) == Some("text") {
                                if let Some(txt) = c.get("text").and_then(|t| t.as_str()) {
                                    text_parts.push(txt.to_string());
                                }
                            }
                        }
                    }
                    if !text_parts.is_empty() {
                        messages.push(ChatMessage::user(text_parts.join("\n")));
                    }
                }

                "assistant" => {
                    let mut text_parts = Vec::new();
                    let mut tool_calls = Vec::new();

                    if let Some(contents) = msg.get("content").and_then(|c| c.as_array()) {
                        for c in contents {
                            let c_type = c.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if c_type == "text" {
                                if let Some(txt) = c.get("text").and_then(|t| t.as_str()) {
                                    text_parts.push(txt.to_string());
                                }
                            } else if c_type == "toolCall" {
                                let id = c.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                let name = c.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                let args = c.get("arguments").cloned().unwrap_or(Value::Null);
                                let args_str = if args.is_string() {
                                    args.as_str().unwrap().to_string()
                                } else {
                                    serde_json::to_string(&args).unwrap_or_default()
                                };

                                tool_calls.push(ToolCall {
                                    id: id.to_string(),
                                    r#type: "function".to_string(),
                                    function: FunctionCall {
                                        name: name.to_string(),
                                        arguments: args_str,
                                    },
                                });
                            }
                        }
                    }

                    let mut chat_msg = ChatMessage::assistant(text_parts.join("\n"));
                    if !tool_calls.is_empty() {
                        chat_msg.tool_calls = Some(tool_calls);
                    }
                    messages.push(chat_msg);
                }

                "toolResult" => {
                    let tool_call_id = msg.get("toolCallId").and_then(|v| v.as_str()).unwrap_or("");
                    let mut text_parts = Vec::new();

                    if let Some(contents) = msg.get("content").and_then(|c| c.as_array()) {
                        for c in contents {
                            if c.get("type").and_then(|t| t.as_str()) == Some("text") {
                                if let Some(txt) = c.get("text").and_then(|t| t.as_str()) {
                                    text_parts.push(txt.to_string());
                                }
                            }
                        }
                    }
                    let res_str = if text_parts.is_empty() {
                        "(no output)".to_string()
                    } else {
                        text_parts.join("\n")
                    };

                    messages.push(ChatMessage::tool_result(tool_call_id, res_str));
                }

                _ => {}
            }
        }

        messages
    }

    pub fn append_entry(&mut self, entry: &Value) -> Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file_path)?;

        let line = serde_json::to_string(entry)?;
        writeln!(file, "{}", line)?;

        if let Some(id) = entry.get("id").and_then(|v| v.as_str()) {
            self.last_entry_id = Some(id.to_string());
        }

        Ok(())
    }

    pub fn append_user_message(&mut self, text: &str) -> Result<String> {
        let entry_id = Uuid::new_v4().simple().to_string()[..8].to_string();
        let now = Utc::now();

        let entry = json!({
            "type": "message",
            "id": entry_id,
            "parentId": self.last_entry_id,
            "timestamp": now.to_rfc3339(),
            "message": {
                "role": "user",
                "content": [
                    { "type": "text", "text": text }
                ],
                "timestamp": now.timestamp_millis()
            }
        });

        self.append_entry(&entry)?;
        Ok(entry_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn append_assistant_message(
        &mut self,
        text: &str,
        reasoning: &str,
        tool_calls: &[ToolCall],
        provider: &str,
        model: &str,
        input_tokens: usize,
        output_tokens: usize,
        stop_reason: &str,
    ) -> Result<String> {
        let entry_id = Uuid::new_v4().simple().to_string()[..8].to_string();
        let now = Utc::now();

        let mut content = Vec::new();

        if !reasoning.is_empty() {
            content.push(json!({
                "type": "thinking",
                "thinking": reasoning
            }));
        }

        if !text.is_empty() {
            content.push(json!({
                "type": "text",
                "text": text
            }));
        }

        for tc in tool_calls {
            let parsed_args: Value = serde_json::from_str(&tc.function.arguments)
                .unwrap_or_else(|_| json!({ "raw": tc.function.arguments }));
            content.push(json!({
                "type": "toolCall",
                "id": tc.id,
                "name": tc.function.name,
                "arguments": parsed_args
            }));
        }

        let entry = json!({
            "type": "message",
            "id": entry_id,
            "parentId": self.last_entry_id,
            "timestamp": now.to_rfc3339(),
            "message": {
                "role": "assistant",
                "content": content,
                "api": "openai-completions",
                "provider": provider,
                "model": model,
                "usage": {
                    "input": input_tokens,
                    "output": output_tokens,
                    "totalTokens": input_tokens + output_tokens
                },
                "stopReason": stop_reason,
                "timestamp": now.timestamp_millis()
            }
        });

        self.append_entry(&entry)?;
        Ok(entry_id)
    }

    pub fn append_tool_result(
        &mut self,
        tool_call_id: &str,
        tool_name: &str,
        output: &str,
        is_error: bool,
    ) -> Result<String> {
        let entry_id = Uuid::new_v4().simple().to_string()[..8].to_string();
        let now = Utc::now();

        let entry = json!({
            "type": "message",
            "id": entry_id,
            "parentId": self.last_entry_id,
            "timestamp": now.to_rfc3339(),
            "message": {
                "role": "toolResult",
                "toolCallId": tool_call_id,
                "toolName": tool_name,
                "content": [
                    { "type": "text", "text": output }
                ],
                "isError": is_error,
                "timestamp": now.timestamp_millis()
            }
        });

        self.append_entry(&entry)?;
        Ok(entry_id)
    }

    pub fn append_model_change(&mut self, provider: &str, model_id: &str, model_name: &str) -> Result<String> {
        let entry_id = Uuid::new_v4().simple().to_string()[..8].to_string();
        let now = Utc::now();

        let entry = json!({
            "type": "model_change",
            "id": entry_id,
            "parentId": self.last_entry_id,
            "timestamp": now.to_rfc3339(),
            "provider": provider,
            "modelId": model_id,
            "name": model_name
        });

        self.append_entry(&entry)?;
        Ok(entry_id)
    }

    pub fn append_thinking_level_change(&mut self, level: &str) -> Result<String> {
        let entry_id = Uuid::new_v4().simple().to_string()[..8].to_string();
        let now = Utc::now();

        let entry = json!({
            "type": "thinking_level_change",
            "id": entry_id,
            "parentId": self.last_entry_id,
            "timestamp": now.to_rfc3339(),
            "thinkingLevel": level
        });

        self.append_entry(&entry)?;
        Ok(entry_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prune_history_messages_turn_slicing() {
        let mut raw = Vec::new();
        // Create 10 user turns, each with an assistant tool call and tool result
        for i in 1..=10 {
            raw.push(ChatMessage::user(format!("User turn {}", i)));
            let mut asst = ChatMessage::assistant(format!("Assistant step {}", i));
            asst.tool_calls = Some(vec![ToolCall {
                id: format!("call_{}", i),
                r#type: "function".to_string(),
                function: FunctionCall {
                    name: "read".to_string(),
                    arguments: "{}".to_string(),
                },
            }]);
            raw.push(asst);
            raw.push(ChatMessage::tool_result(format!("call_{}", i), format!("Output {}", i)));
        }

        assert_eq!(raw.len(), 30);
        let pruned = SessionJournal::prune_history_messages(raw, 4);

        // Retains 4 turns: turns 7, 8, 9, 10 => 12 messages
        assert_eq!(pruned.len(), 12);
        assert_eq!(pruned[0].role, "user");
        if let Some(crate::protocol::ChatContent::Text(ref txt)) = pruned[0].content {
            assert_eq!(txt, "User turn 7");
        } else {
            panic!("Expected text content");
        }
    }

    #[test]
    fn test_prune_history_messages_tool_truncation() {
        let mut raw = Vec::new();
        let giant_output = "A".repeat(3000);

        // Turn 1: has giant tool output
        raw.push(ChatMessage::user("Turn 1"));
        raw.push(ChatMessage::assistant("Running tool"));
        raw.push(ChatMessage::tool_result("call_1", &giant_output));

        // Turn 2: has giant tool output
        raw.push(ChatMessage::user("Turn 2"));
        raw.push(ChatMessage::assistant("Running tool"));
        raw.push(ChatMessage::tool_result("call_2", &giant_output));

        // Turn 3 (recent turn): has giant tool output
        raw.push(ChatMessage::user("Turn 3"));
        raw.push(ChatMessage::assistant("Running tool"));
        raw.push(ChatMessage::tool_result("call_3", &giant_output));

        // Turn 4 (most recent turn): has giant tool output
        raw.push(ChatMessage::user("Turn 4"));
        raw.push(ChatMessage::assistant("Running tool"));
        raw.push(ChatMessage::tool_result("call_4", &giant_output));

        let pruned = SessionJournal::prune_history_messages(raw, 5);
        assert_eq!(pruned.len(), 12);

        // Turn 1 tool result (idx 2) is older than the last 2 turns, should be truncated
        if let Some(crate::protocol::ChatContent::Text(ref txt)) = pruned[2].content {
            assert!(txt.len() < 3000);
            assert!(txt.contains("已自动截断"));
        } else {
            panic!("Expected text content");
        }

        // Turn 4 tool result (idx 11, most recent turn) should retain full output
        if let Some(crate::protocol::ChatContent::Text(ref txt)) = pruned[11].content {
            assert_eq!(txt.len(), 3000);
        } else {
            panic!("Expected text content");
        }
    }

    #[test]
    fn test_prune_history_messages_bounds_a_single_tool_heavy_turn() {
        // One turn with 40 tool results of 3,000 chars each = 120,000 chars, far
        // past the 48,000 budget. Previously only the per-message cap applied, so
        // the whole turn sailed through and real requests ballooned to 25k-42k
        // tokens. The total budget must now shrink it within a single turn.
        let mut raw = Vec::new();
        raw.push(ChatMessage::user("do a big task"));
        for i in 0..40 {
            let mut asst = ChatMessage::assistant("");
            asst.tool_calls = Some(vec![ToolCall {
                id: format!("call_{}", i),
                r#type: "function".to_string(),
                function: FunctionCall {
                    name: "bash".to_string(),
                    arguments: "{}".to_string(),
                },
            }]);
            raw.push(asst);
            raw.push(ChatMessage::tool_result(format!("call_{}", i), "Z".repeat(3000)));
        }

        let pruned = SessionJournal::prune_history_messages(raw, 5);
        let total: usize = pruned
            .iter()
            .map(|m| match &m.content {
                Some(crate::protocol::ChatContent::Text(t)) => t.chars().count(),
                _ => 0,
            })
            .sum();
        assert!(
            total <= 48_000,
            "a single tool-heavy turn must respect the 48k budget, got {}",
            total
        );
    }

    fn write_call(id: &str, path: &str, body_len: usize) -> ChatMessage {
        let mut asst = ChatMessage::assistant("");
        asst.tool_calls = Some(vec![ToolCall {
            id: id.to_string(),
            r#type: "function".to_string(),
            function: FunctionCall {
                name: "write".to_string(),
                arguments: json!({
                    "path": path,
                    "content": "B".repeat(body_len),
                })
                .to_string(),
            },
        }]);
        asst
    }

    #[test]
    fn test_prune_bounds_write_arguments() {
        // The `db2133cc` shape: 270,723 characters of assistant messages, almost
        // all of it `write` call arguments. The budget counted only `content`, so
        // every one of these was invisible and the request reached 78k tokens.
        let mut raw = Vec::new();
        raw.push(ChatMessage::user("write a lot of files"));
        for i in 0..20 {
            raw.push(write_call(&format!("call_{i}"), &format!("/tmp/f{i}.txt"), 15_000));
            raw.push(ChatMessage::tool_result(format!("call_{i}"), "ok"));
        }
        raw.push(ChatMessage::user("now summarize"));

        let pruned = SessionJournal::prune_history_messages(raw, 5);
        let total: usize = pruned.iter().map(message_chars).sum();
        assert!(
            total <= MAX_TOTAL_CHARS,
            "write arguments must count against the budget, got {total} chars"
        );

        // The file paths must survive so the model still knows what it did.
        let kept_path = pruned.iter().any(|m| {
            m.tool_calls.as_ref().is_some_and(|calls| {
                calls
                    .iter()
                    .any(|c| c.function.arguments.contains("/tmp/f0.txt"))
            })
        });
        assert!(kept_path, "the path field must not be folded away");

        // ...and every argument payload must still be valid JSON.
        for m in &pruned {
            for call in m.tool_calls.iter().flatten() {
                let parsed: Result<Value, _> = serde_json::from_str(&call.function.arguments);
                assert!(parsed.is_ok(), "folded arguments must stay valid JSON");
            }
        }
    }

    #[test]
    fn test_prune_keeps_the_live_turn_write_arguments() {
        // The newest turn is what the model is working on right now: a payload
        // that fits the budget must not be folded out from under it.
        let raw = vec![
            ChatMessage::user("write one file"),
            write_call("call_live", "/tmp/live.txt", 8_000),
        ];

        let pruned = SessionJournal::prune_history_messages(raw, 5);
        let body_kept = pruned.iter().any(|m| {
            m.tool_calls.as_ref().is_some_and(|calls| {
                calls.iter().any(|c| c.function.arguments.contains(&"B".repeat(8_000)))
            })
        });
        assert!(body_kept, "the live turn's arguments must survive intact");
    }

    #[test]
    fn test_shrink_arguments_keeps_json_and_small_fields() {
        let raw = json!({
            "path": "/tmp/keep.txt",
            "content": "C".repeat(9_000),
            "nested": { "note": "D".repeat(3_000) },
        })
        .to_string();

        let shrunk = shrink_arguments(&raw, ARG_STRING_KEEP).expect("must shrink");
        assert!(shrunk.len() < raw.len() / 2, "payload must actually shrink");
        let v: Value = serde_json::from_str(&shrunk).expect("must stay valid JSON");
        assert_eq!(v["path"], "/tmp/keep.txt");
        assert!(v["nested"]["note"].as_str().unwrap().contains("已省略"));
    }

    #[test]
    fn test_shrink_arguments_is_a_noop_for_small_payloads() {
        let raw = json!({ "path": "/tmp/small.txt", "content": "hi" }).to_string();
        assert!(shrink_arguments(&raw, ARG_STRING_KEEP).is_none());
    }

    #[test]
    fn test_shrink_message_reasoning_folds_only_oversized() {
        let mut big = ChatMessage::assistant("answer");
        big.reasoning_content = Some("R".repeat(9_000));
        assert!(shrink_message_reasoning(&mut big, ARG_STRING_KEEP));
        let folded = big.reasoning_content.clone().unwrap();
        assert!(folded.contains("已省略 9000 字符"), "got {folded}");
        assert!(folded.chars().count() < 60, "marker must be short");

        // Idempotent: a second pass finds nothing left to fold.
        assert!(!shrink_message_reasoning(&mut big, ARG_STRING_KEEP));

        let mut small = ChatMessage::assistant("answer");
        small.reasoning_content = Some("short thought".into());
        assert!(!shrink_message_reasoning(&mut small, ARG_STRING_KEEP));
    }

    #[test]
    fn test_prune_bounds_reasoning_and_keeps_the_live_turn() {
        // Reasoning is resent on every call in a turn and reached 98,143 chars
        // in one measured turn; it must count against the budget.
        let mut raw = Vec::new();
        for i in 0..8 {
            raw.push(ChatMessage::user(format!("step {i}")));
            let mut asst = ChatMessage::assistant("ok");
            asst.reasoning_content = Some("T".repeat(20_000));
            raw.push(asst);
        }

        let pruned = SessionJournal::prune_history_messages(raw, 5);
        let total: usize = pruned.iter().map(message_chars).sum();
        assert!(
            total <= MAX_TOTAL_CHARS,
            "reasoning must count against the budget, got {total} chars"
        );

        // The newest assistant message keeps its reasoning intact.
        let last_reasoning = pruned
            .iter()
            .rev()
            .find_map(|m| m.reasoning_content.as_ref())
            .expect("reasoning present");
        assert_eq!(
            last_reasoning.chars().count(),
            20_000,
            "the live turn's reasoning must survive"
        );
    }

    #[test]
    fn test_prune_folds_reasoning_that_alone_blows_the_budget() {
        // One turn, no tool results: the only thing left to shrink is reasoning,
        // so the budget loop has to reach it instead of spinning.
        let mut raw = vec![ChatMessage::user("think hard")];
        let mut asst = ChatMessage::assistant("done");
        asst.reasoning_content = Some("T".repeat(120_000));
        raw.push(asst);

        let pruned = SessionJournal::prune_history_messages(raw, 5);
        let total: usize = pruned.iter().map(message_chars).sum();
        assert!(
            total <= MAX_TOTAL_CHARS,
            "reasoning alone must be folded to fit, got {total} chars"
        );
        assert!(pruned[1].reasoning_content.as_ref().unwrap().contains("已省略"));
    }
}
