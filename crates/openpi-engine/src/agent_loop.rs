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
    pub config: std::sync::RwLock<EngineConfig>,
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
            config: std::sync::RwLock::new(config),
            tool_registry,
            llm_client: LlmClient::new(),
            event_tx,
        }
    }

    pub fn reload_config(&self) -> Result<()> {
        let new_cfg = EngineConfig::load()?;
        let mut w = self.config.write().map_err(|e| anyhow::anyhow!("Poisoned lock: {}", e))?;
        *w = new_cfg;
        info!("Native engine config hot-reloaded successfully from disk");
        Ok(())
    }

    fn compact_inflight_messages(messages: &mut [ChatMessage]) {
        let tool_indices: Vec<usize> = messages
            .iter()
            .enumerate()
            .filter(|(_, m)| m.role == "tool")
            .map(|(i, _)| i)
            .collect();

        let total_tools = tool_indices.len();
        if total_tools <= 2 {
            return;
        }

        let recent_cutoff = tool_indices[total_tools - 2];

        for &idx in &tool_indices {
            if idx < recent_cutoff {
                if let Some(crate::protocol::ChatContent::Text(ref mut txt)) = messages[idx].content {
                    let total_chars = txt.chars().count();
                    if total_chars > 1000 {
                        let head: String = txt.chars().take(350).collect();
                        let tail: String = txt.chars().skip(total_chars.saturating_sub(150)).collect();
                        *txt = format!(
                            "{}\n... [前序步骤工具执行结果已折叠，已省略 {} 字符以节省上下文] ...\n{}",
                            head,
                            total_chars.saturating_sub(500),
                            tail
                        );
                    }
                }
            }
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
        let model_cfg = {
            let r = self.config.read().map_err(|e| anyhow::anyhow!("Poisoned lock: {}", e))?;
            match r.resolve_model(model_override) {
                Ok(cfg) => cfg,
                Err(err) => {
                    drop(r);
                    info!("Model not found in cached engine config, reloading models.json from disk...");
                    let _ = self.reload_config();
                    let r2 = self.config.read().map_err(|e| anyhow::anyhow!("Poisoned lock: {}", e))?;
                    r2.resolve_model(model_override).map_err(|e| {
                        anyhow::anyhow!("无法定位或合成模型配置 ({}): {}", e, err)
                    })?
                }
            }
        };
        let mut journal = SessionJournal::open(session_id);

        // 1. Read existing conversation history from journal
        let history = journal.load_history_messages();

        // 2. Append current user prompt to journal
        journal.append_user_message(user_prompt)?;

        let user_now = chrono::Utc::now().timestamp_millis();
        let _ = self.event_tx.send((
            session_id.to_string(),
            json!({
                "type": "message_end",
                "message": {
                    "role": "user",
                    "content": [{ "type": "text", "text": user_prompt }],
                    "timestamp": user_now
                }
            }),
        ));

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
        let persona = crate::config::PersonaConfig::load();
        let persona_directive = persona.to_prompt_directive();
        let all_skills = crate::skill_synthesizer::scan_all_skills();
        let skills_directive = crate::skill_synthesizer::format_skills_prompt_directive(&all_skills);

        let system_prompt = format!(
            "You are OpenPI, an autonomous AI software engineer running on the native Rust engine (openpi-engine).\n\
             Workspace: {}\n\
             Principles:\n\
             1. Fast, surgical execution: use read to inspect files, edit/search_replace to perform minimal atomic updates, and bash to test or run commands.\n\
             2. Be decisive and efficient: avoid redundant repeated searches, excessive read cycles, or unnecessary multiple rounds of verification. When the target code or root cause is clear, make the edit directly.\n\
             3. Never run broad recursive searches across the home directory; use targeted grep or find instead.\n\
             4. [Dream-RSI Prior ({}, Beta* = {:.2})]: Focus strictly on solving the assigned task with low churn and high precision.{}{}",
            cwd, ctx_label, beta, persona_directive, skills_directive
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
        let (is_unlimited, max_steps) = {
            let cfg_guard = self.config.read().map_err(|e| anyhow::anyhow!("Poisoned lock: {}", e))?;
            let is_unlim = cfg_guard.max_steps == 0;
            let ms = if is_unlim { usize::MAX } else { cfg_guard.max_steps.max(25) };
            (is_unlim, ms)
        };
        let mut last_assistant_text = String::new();
        let mut finished_normally = false;
        // Consecutive completions that produced neither visible text nor tool calls
        // (e.g. reasoning-only / truncated responses). Those must never be mistaken
        // for a finished turn, or the agent silently stops mid-task.
        let mut empty_streak: usize = 0;
        const MAX_EMPTY_RETRIES: usize = 2;

        while step < max_steps {
            if cancel_token.is_cancelled() {
                warn!("Turn cancelled by user token");
                break;
            }

            step += 1;
            if is_unlimited {
                info!("Cognitive turn step {}/unlimited for session {}", step, session_id);
            } else {
                info!("Cognitive turn step {}/{} for session {}", step, max_steps, session_id);
            }

            // Announce turn start and assistant message start
            let _ = self.event_tx.send((
                session_id.to_string(),
                json!({
                    "type": "turn_start",
                    "step": step,
                    "maxSteps": if is_unlimited { 0 } else { max_steps },
                    "model": model_cfg.id,
                    "provider": model_cfg.provider
                }),
            ));
            let _ = self.event_tx.send((
                session_id.to_string(),
                json!({
                    "type": "message_start",
                    "message": { "role": "assistant" }
                }),
            ));

            // Compact older tool results in active_messages to preserve lean context and fast TTFT
            Self::compact_inflight_messages(&mut active_messages);

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
                    let err_display = format!("⚠️ 请求模型失败：{}", e);
                    let _ = journal.append_assistant_message(
                        &err_display,
                        "",
                        &[],
                        &model_cfg.provider,
                        &model_cfg.id,
                        0,
                        0,
                        "error",
                    );
                    let _ = self.event_tx.send((
                        session_id.to_string(),
                        json!({
                            "type": "stream_error",
                            "error": e.to_string()
                        }),
                    ));
                    let _ = self.event_tx.send((session_id.to_string(), json!({ "type": "turn_end" })));
                    let _ = self.event_tx.send((session_id.to_string(), json!({ "type": "agent_settled" })));
                    return Err(e);
                }
            };

            last_assistant_text = llm_res.text.clone();

            let in_tok = llm_res.usage.as_ref().map(|u| u.prompt_tokens).unwrap_or(0);
            let out_tok = llm_res.usage.as_ref().map(|u| u.completion_tokens).unwrap_or(0);

            if !llm_res.tool_calls.is_empty() {
                empty_streak = 0;
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
                if llm_res.text.trim().is_empty() {
                    // OpenAI-compatible APIs expect `content: null` (not "") on an
                    // assistant message that only carries tool calls.
                    asst_msg.content = None;
                }
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
                    let exec_result = match self.tool_registry.execute(
                        &tc.function.name,
                        &parsed_args,
                        cwd,
                    ).await {
                        Ok(res) => res,
                        Err(e) => {
                            warn!("Tool execution error for {}: {}", tc.function.name, e);
                            crate::tool_registry::ToolExecutionResult {
                                output: format!("Tool error: {}", e),
                                is_error: true,
                            }
                        }
                    };

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
            } else if llm_res.text.trim().is_empty() {
                // The provider produced neither tool calls nor visible text. This is
                // what happens with reasoning-only / truncated completions, and it
                // must NOT be treated as a finished answer (otherwise the agent
                // silently stops mid-task with an empty "stop").
                empty_streak += 1;
                warn!(
                    "Session {} step {}: empty completion (no text, no tool calls; reasoning {} chars, finish_reason {:?}), attempt {}/{}",
                    session_id,
                    step,
                    llm_res.reasoning.chars().count(),
                    llm_res.finish_reason,
                    empty_streak,
                    MAX_EMPTY_RETRIES
                );

                if empty_streak <= MAX_EMPTY_RETRIES {
                    active_messages.push(ChatMessage::assistant(
                        "<上一条回复只包含思考内容，未产生任何正文或工具调用>",
                    ));
                    active_messages.push(ChatMessage::user(
                        "你刚才只输出了思考内容，没有给出任何面向用户的回答，也没有调用任何工具。请停止内部推理，立即给出结论，或调用工具继续执行任务。",
                    ));
                    continue;
                }

                let msg = "⚠️ 模型连续多次只返回思考内容、未产生任何回答或工具调用，本轮已中止。请重试，或在设置中更换为更稳定的模型。";
                journal.append_assistant_message(
                    msg,
                    "",
                    &[],
                    &model_cfg.provider,
                    &model_cfg.id,
                    in_tok,
                    out_tok,
                    "error",
                )?;
                let asst_now = chrono::Utc::now().timestamp_millis();
                let _ = self.event_tx.send((
                    session_id.to_string(),
                    json!({
                        "type": "message_end",
                        "message": {
                            "role": "assistant",
                            "content": [{ "type": "text", "text": msg }],
                            "timestamp": asst_now
                        }
                    }),
                ));
                let _ = self.event_tx.send((
                    session_id.to_string(),
                    json!({ "type": "stream_error", "error": msg }),
                ));
                finished_normally = true;
                break;
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

                let asst_now = chrono::Utc::now().timestamp_millis();
                let _ = self.event_tx.send((
                    session_id.to_string(),
                    json!({
                        "type": "message_end",
                        "message": {
                            "role": "assistant",
                            "content": [{ "type": "text", "text": llm_res.text }],
                            "timestamp": asst_now
                        }
                    }),
                ));
                finished_normally = true;
                break;
            }
        }

        // If the turn reached max_steps without returning a final textual response,
        // request a final synthesis step from the LLM with tools disabled so the user
        // receives a complete summary instead of an abrupt silent stop.
        if !finished_normally && !cancel_token.is_cancelled() && step >= max_steps {
            warn!("Session {} reached max steps ({}), requesting final synthesis", session_id, max_steps);
            let _ = self.event_tx.send((
                session_id.to_string(),
                json!({
                    "type": "message_start",
                    "message": { "role": "assistant" }
                }),
            ));

            active_messages.push(ChatMessage::user(
                "⚠️ [系统提示]：本轮连续工具调用已达最大步数上限。工具现已关闭，请根据上方已经执行的所有工具调用和探索结果，向用户详细总结汇报当前进展、发现的核心内容、结论以及后续建议。"
            ));

            Self::compact_inflight_messages(&mut active_messages);

            let synthesis_res = self.llm_client.stream_chat_completion(
                &model_cfg,
                active_messages.clone(),
                None, // Tools disabled to force a textual summary
                cancel_token.clone(),
                bridge.as_ref(),
            ).await;

            match synthesis_res {
                Ok(res) => {
                    let synth_text = if res.text.trim().is_empty() {
                        format!(
                            "⚠️ 本轮执行已达到最大步数限制（已执行 {} 步），且模型未返回总结内容。你可以发送“继续”指令让助手接着处理。",
                            max_steps
                        )
                    } else {
                        res.text.clone()
                    };
                    last_assistant_text = synth_text.clone();
                    let in_tok = res.usage.as_ref().map(|u| u.prompt_tokens).unwrap_or(0);
                    let out_tok = res.usage.as_ref().map(|u| u.completion_tokens).unwrap_or(0);

                    let _ = journal.append_assistant_message(
                        &synth_text,
                        &res.reasoning,
                        &[],
                        &model_cfg.provider,
                        &model_cfg.id,
                        in_tok,
                        out_tok,
                        "stop",
                    );

                    let asst_now = chrono::Utc::now().timestamp_millis();
                    let _ = self.event_tx.send((
                        session_id.to_string(),
                        json!({
                            "type": "message_end",
                            "message": {
                                "role": "assistant",
                                "content": [{ "type": "text", "text": synth_text }],
                                "timestamp": asst_now
                            }
                        }),
                    ));
                }
                Err(e) => {
                    warn!("Failed to stream final synthesis at max steps: {}", e);
                    let fallback_text = format!(
                        "⚠️ 本轮执行已达到最大步数限制（已执行 {} 步）。以上为已完成的阶段性探索，你可以发送“继续”指令让助手接着处理。",
                        max_steps
                    );
                    last_assistant_text = fallback_text.clone();
                    let _ = journal.append_assistant_message(
                        &fallback_text,
                        "",
                        &[],
                        &model_cfg.provider,
                        &model_cfg.id,
                        0,
                        0,
                        "stop",
                    );
                    let asst_now = chrono::Utc::now().timestamp_millis();
                    let _ = self.event_tx.send((
                        session_id.to_string(),
                        json!({
                            "type": "message_end",
                            "message": {
                                "role": "assistant",
                                "content": [{ "type": "text", "text": fallback_text }],
                                "timestamp": asst_now
                            }
                        }),
                    ));
                }
            }
        }

        // 5. Emit turn_end and agent_settled
        let _ = self.event_tx.send((session_id.to_string(), json!({ "type": "turn_end" })));
        let _ = self.event_tx.send((session_id.to_string(), json!({ "type": "agent_settled" })));

        // 6. Trigger offline Jev dreaming in background
        let jev_bg = self.tool_registry.jev.clone();
        let s_dir = crate::config::sessions_dir();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let _ = jev_bg.trigger_offline_dreaming(&s_dir).await;
        });

        // 7. Trigger Autonomous Memory Stage 1 thread extraction
        let sid = session_id.to_string();
        let cwd_str = cwd.to_string();
        let prompt_str = user_prompt.to_string();
        let answer_for_mem = last_assistant_text.clone();
        let llm_client_mem = self.llm_client.clone();
        let model_cfg_mem = model_cfg.clone();
        tokio::spawn(async move {
            let _ = crate::memory_worker::autonomous_memory_extract(
                &sid,
                &cwd_str,
                &prompt_str,
                &answer_for_mem,
                Some((&llm_client_mem, &model_cfg_mem)),
            ).await;
        });

        // 8. Trigger Autonomous Title Summarization and broadcast if refined
        let event_tx_title = self.event_tx.clone();
        let sid_title = session_id.to_string();
        let prompt_title = user_prompt.to_string();
        let answer_title = last_assistant_text;
        let llm_client = self.llm_client.clone();
        let model_for_title = model_cfg.clone();
        tokio::spawn(async move {
            if let Ok(refined_title) = crate::title_summarizer::summarize_title_llm(&llm_client, &model_for_title, &prompt_title, &answer_title).await {
                if !refined_title.is_empty() && refined_title != "新对话" {
                    let _ = event_tx_title.send((sid_title.clone(), serde_json::json!({
                        "type": "session_renamed",
                        "sessionId": sid_title,
                        "name": refined_title,
                    })));
                }
            }
        });

        Ok(())
    }
}
