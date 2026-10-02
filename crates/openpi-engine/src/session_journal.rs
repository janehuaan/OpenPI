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

    pub fn load_history_messages(&self) -> Vec<ChatMessage> {
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
}
