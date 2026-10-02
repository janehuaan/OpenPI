use anyhow::Result;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::config::EngineConfig;
use crate::llm_client::{LlmClient, StreamEventHandler};
use crate::protocol::ChatMessage;
use crate::session_journal::SessionJournal;
use crate::tool_registry::ToolRegistry;

struct DesktopStreamBridge {
    session_id: String,
    event_tx: broadcast::Sender<(String, Value)>,
}

impl StreamEventHandler for DesktopStreamBridge {
    fn on_reasoning_start(&self) {
        let ev = json!({
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "thinking_start"
            }
        });
        let _ = self.event_tx.send((self.session_id.clone(), ev));
    }

    fn on_reasoning_delta(&self, delta: &str) {
        let ev = json!({
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "thinking_delta",
                "delta": delta
            }
        });
        let _ = self.event_tx.send((self.session_id.clone(), ev));
    }

    fn on_reasoning_end(&self) {
        let ev = json!({
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "thinking_end"
            }
        });
        let _ = self.event_tx.send((self.session_id.clone(), ev));
    }

    fn on_text_start(&self) {
        let ev = json!({
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "text_start"
            }
        });
        let _ = self.event_tx.send((self.session_id.clone(), ev));
    }

    fn on_text_delta(&self, delta: &str) {
        let ev = json!({
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "text_delta",
                "delta": delta
            }
        });
        let _ = self.event_tx.send((self.session_id.clone(), ev));
    }

    fn on_text_end(&self) {
        let ev = json!({
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "text_end"
            }
        });
        let _ = self.event_tx.send((self.session_id.clone(), ev));
    }

    fn on_tool_call_start(&self, index: usize, id: &str, name: &str) {
        let ev = json!({
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "toolcall_start",
                "contentIndex": index,
                "id": id,
                "toolName": name
            }
        });
        let _ = self.event_tx.send((self.session_id.clone(), ev));
    }

    fn on_tool_call_delta(&self, index: usize, id: &str, delta: &str) {
        let ev = json!({
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "toolcall_delta",
                "contentIndex": index,
                "id": id,
                "delta": delta
            }
        });
        let _ = self.event_tx.send((self.session_id.clone(), ev));
    }

    fn on_tool_call_end(&self, index: usize, id: &str) {
        let ev = json!({
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "toolcall_end",
                "contentIndex": index,
                "id": id
            }
        });
        let _ = self.event_tx.send((self.session_id.clone(), ev));
    }
}

pub struct AgentLoop {
    pub config: EngineConfig,
    pub tool_registry: ToolRegistry,
    pub llm_client: LlmClient,
    pub event_tx: broadcast::Sender<(String, Value)>,
}

impl AgentLoop {
    pub fn new(
        config: EngineConfig,
        tool_registry: ToolRegistry,
        event_tx: broadcast::Sender<(String, Value)>,
    ) -> Self {
        Self {
            config,
            tool_registry,
            llm_client: LlmClient::new(),
            event_tx,
        }
    }

    pub async fn run_turn(
        &self,
        session_id: &str,
        user_prompt: &str,
        cwd: &str,
        model_override: Option<&str>,
        cancel_token: CancellationToken,
    ) -> Result<()> {
        let model_cfg = self.config.resolve_model(model_override)?;
        let mut journal = SessionJournal::open(session_id);

        // 1. Read existing conversation history from journal
        let history = journal.load_history_messages();

        // 2. Append current user prompt to journal
        journal.append_user_message(user_prompt)?;

        // 3. Assemble full prompt messages
        let mut active_messages = Vec::new();

        // Contextual Beta from Jev
        let prompt_lower = user_prompt.to_lowercase();
        let (ctx_key, ctx_label) = if prompt_lower.contains("fix") || prompt_lower.contains("bug") || prompt_lower.contains("报错") || prompt_lower.contains("修复") {
            ("quick_fix", "缺陷自愈（QuickFix）")
        } else if prompt_lower.contains("refactor") || prompt_lower.contains("重构") || prompt_lower.contains("迁移") || prompt_lower.contains("rewrite") {
            ("refactor", "架构重构（Refactor）")
        } else {
            ("general", "综合稳健（General）")
        };

        let beta = self.tool_registry.jev.contextual_beta(ctx_key).await;
        let system_prompt = format!(
            "You are OpenPI, an autonomous AI software engineer running on the native Rust engine (openpi-engine).\n\
             Workspace: {}\n\
             Principles:\n\
             1. Fast, surgical execution: use read to inspect files, edit/search_replace to perform minimal atomic updates, and bash to test or run commands.\n\
             2. Always inspect files or run safe commands rather than guessing.\n\
             3. Never run broad recursive searches across the home directory; use targeted grep or find instead.\n\
             4. [Dream-RSI Prior ({}, Beta* = {:.2})]: Focus strictly on solving the assigned task with low churn and high precision.",
            cwd, ctx_label, beta
        );

        active_messages.push(ChatMessage::system(system_prompt));
        active_messages.extend(history);
        active_messages.push(ChatMessage::user(user_prompt));

        let tool_defs = self.tool_registry.definitions();

        // 4. Emit rpc_ready & agent_start
        let _ = self.event_tx.send((session_id.to_string(), json!({ "type": "rpc_ready" })));
        let _ = self.event_tx.send((session_id.to_string(), json!({ "type": "agent_start" })));

        let bridge = Arc::new(DesktopStreamBridge {
            session_id: session_id.to_string(),
            event_tx: self.event_tx.clone(),
        });

        let mut step = 0;
        let max_steps = 25;

        while step < max_steps {
            if cancel_token.is_cancelled() {
                warn!("Turn cancelled by user token");
                break;
            }

            step += 1;
            info!("Cognitive turn step {}/{} for session {}", step, max_steps, session_id);

            // Announce assistant message start
            let _ = self.event_tx.send((
                session_id.to_string(),
                json!({
                    "type": "message_start",
                    "message": { "role": "assistant" }
                }),
            ));

            let llm_res = match self.llm_client.stream_chat_completion(
                &model_cfg,
                active_messages.clone(),
                Some(tool_defs.clone()),
                cancel_token.clone(),
                bridge.as_ref(),
            ).await {
                Ok(res) => res,
                Err(e) => {
                    warn!("LLM execution error at step {}: {}", step, e);
                    let _ = self.event_tx.send((
                        session_id.to_string(),
                        json!({
                            "type": "stream_error",
                            "error": e.to_string()
                        }),
                    ));
                    return Err(e);
                }
            };

            let in_tok = llm_res.usage.as_ref().map(|u| u.prompt_tokens).unwrap_or(0);
            let out_tok = llm_res.usage.as_ref().map(|u| u.completion_tokens).unwrap_or(0);

            if !llm_res.tool_calls.is_empty() {
                // Assistant issued tool calls
                journal.append_assistant_message(
                    &llm_res.text,
                    &llm_res.reasoning,
                    &llm_res.tool_calls,
                    &model_cfg.provider,
                    &model_cfg.id,
                    in_tok,
                    out_tok,
                    "toolUse",
                )?;

                let mut asst_msg = ChatMessage::assistant(&llm_res.text);
                asst_msg.tool_calls = Some(llm_res.tool_calls.clone());
                active_messages.push(asst_msg);

                // Execute each tool call sequentially
                for tc in &llm_res.tool_calls {
                    if cancel_token.is_cancelled() {
                        break;
                    }

                    let parsed_args: Value = serde_json::from_str(&tc.function.arguments)
                        .unwrap_or_else(|_| json!({ "raw": tc.function.arguments }));

                    // Emit tool_execution_start
                    let _ = self.event_tx.send((
                        session_id.to_string(),
                        json!({
                            "type": "tool_execution_start",
                            "toolCallId": tc.id,
                            "toolName": tc.function.name,
                            "args": parsed_args
                        }),
                    ));

                    // Execute tool natively in Rust
                    let exec_result = self.tool_registry.execute(
                        &tc.function.name,
                        &parsed_args,
                        cwd,
                    ).await?;

                    // Emit tool_execution_end
                    let _ = self.event_tx.send((
                        session_id.to_string(),
                        json!({
                            "type": "tool_execution_end",
                            "toolCallId": tc.id,
                            "toolName": tc.function.name,
                            "result": exec_result.output,
                            "isError": exec_result.is_error
                        }),
                    ));

                    // Append tool result to journal and context
                    journal.append_tool_result(
                        &tc.id,
                        &tc.function.name,
                        &exec_result.output,
                        exec_result.is_error,
                    )?;

                    active_messages.push(ChatMessage::tool_result(&tc.id, &exec_result.output));
                }
            } else {
                // Final textual response (no further tool calls)
                journal.append_assistant_message(
                    &llm_res.text,
                    &llm_res.reasoning,
                    &[],
                    &model_cfg.provider,
                    &model_cfg.id,
                    in_tok,
                    out_tok,
                    "stop",
                )?;
                break;
            }
        }

        // 5. Emit agent_settled
        let _ = self.event_tx.send((session_id.to_string(), json!({ "type": "agent_settled" })));

        // 6. Trigger offline Jev dreaming in background
        let jev_bg = self.tool_registry.jev.clone();
        let s_dir = crate::config::sessions_dir();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = jev_bg.trigger_offline_dreaming(&s_dir).await;
        });

        Ok(())
    }
}
