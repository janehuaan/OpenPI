use anyhow::Result;
use chrono::Utc;
use serde_json::{json, Value};
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use uuid::Uuid;

use crate::config::sessions_dir;
use crate::protocol::{ChatMessage, FunctionCall, ToolCall};

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

        // 4. Global character budget enforcement (~48,000 chars ~ 12,000 tokens)
        const MAX_TOTAL_CHARS: usize = 48_000;
        const HARD_TOOL_FLOOR: usize = 400;

        fn total_chars(messages: &[ChatMessage]) -> usize {
            messages
                .iter()
                .map(|m| match &m.content {
                    Some(crate::protocol::ChatContent::Text(t)) => t.chars().count(),
                    _ => 0,
                })
                .sum()
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
        while total_chars(&sliced) > MAX_TOTAL_CHARS {
            let mut worst: Option<(usize, usize)> = None;
            for (i, m) in sliced.iter().enumerate() {
                if m.role != "tool" {
                    continue;
                }
                if let Some(crate::protocol::ChatContent::Text(t)) = &m.content {
                    let n = t.chars().count();
                    let is_worst = match worst {
                        Some((_, w)) => n > w,
                        None => true,
                    };
                    if n > HARD_TOOL_FLOOR * 2 && is_worst {
                        worst = Some((i, n));
                    }
                }
            }
            let Some((idx, len)) = worst else { break };
            let target = (len / 2).max(HARD_TOOL_FLOOR);
            if let Some(crate::protocol::ChatContent::Text(ref mut t)) = sliced[idx].content {
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
}
