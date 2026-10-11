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

/// Background memory extraction and title summarization each cost an extra LLM
/// round-trip per turn. Running both on every turn tripled the calls behind a
/// single user message; sample them on this cadence instead.
const BACKGROUND_TURN_INTERVAL: u64 = 3;

/// In-flight folding is conservative: these messages belong to the turn that is
/// still running, so only clearly oversized payloads are folded.
const INFLIGHT_ARG_STRING_KEEP: usize = 2000;

#[derive(Debug, Clone)]
pub struct ReviewResult {
    pub approved: bool,
    pub critique: String,
    pub reviewer_id: String,
    pub provider_id: String,
}

pub(crate) fn parse_review_output(text: &str) -> (bool, String) {
    let lower = text.to_lowercase();
    if lower.contains("status: rejected") || lower.contains("status: reject") || lower.starts_with("rejected") {
        (false, text.to_string())
    } else if lower.contains("status: approved") || lower.contains("status: approve") || lower.starts_with("approved") {
        (true, text.to_string())
    } else if lower.contains("defects:") || lower.contains("defect:") || lower.contains("flaws:") {
        (false, text.to_string())
    } else {
        (true, text.to_string())
    }
}

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

        // Fold everything before the last two results. Tool *results* are the
        // obvious bulk, but a `write` call carries the whole file body in its
        // arguments, and reasoning is resent on every call too: one session held
        // 270,723 characters of arguments and 98,143 characters of reasoning this
        // way, which is what took its requests to 78k tokens.
        for (idx, msg) in messages.iter_mut().enumerate() {
            if idx >= recent_cutoff {
                break;
            }
            if let Some(crate::protocol::ChatContent::Text(ref mut txt)) = msg.content {
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
            crate::session_journal::shrink_message_arguments(msg, INFLIGHT_ARG_STRING_KEEP);
            crate::session_journal::shrink_message_reasoning(msg, INFLIGHT_ARG_STRING_KEEP);
        }
    }

    async fn execute_review(
        llm: &LlmClient,
        rev_cfg: &crate::config::ModelConfig,
        user_prompt: &str,
        actor_reply: &str,
        tool_actions: &[String],
        cwd: &str,
        cancel_token: CancellationToken,
    ) -> Result<ReviewResult> {
        let git_dir = std::path::Path::new(cwd).join(".git");
        let git_diff = if git_dir.exists() {
            // 1. Fast check: check if any tracked/staged files actually changed
            let status_out = tokio::process::Command::new("git")
                .args(["diff", "--name-only", "HEAD"])
                .current_dir(cwd)
                .output()
                .await
                .ok();

            let has_changes = status_out
                .as_ref()
                .and_then(|o| String::from_utf8(o.stdout.clone()).ok())
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false);

            if !has_changes {
                // Zero file modifications: immediately pass in < 5ms without burning LLM time!
                return Ok(ReviewResult {
                    approved: true,
                    critique: "无实际代码变更，质检秒级自动放行。".into(),
                    reviewer_id: rev_cfg.id.clone(),
                    provider_id: rev_cfg.provider.clone(),
                });
            }

            // 2. Focused diff excluding lockfiles, build caches, and node_modules
            tokio::process::Command::new("git")
                .args([
                    "diff",
                    "HEAD",
                    "--",
                    ".",
                    ":!*.lock",
                    ":!yarn.lock",
                    ":!Cargo.lock",
                    ":!package-lock.json",
                    ":!dist",
                    ":!target",
                    ":!node_modules",
                    ":!.next",
                ])
                .current_dir(cwd)
                .output()
                .await
                .ok()
                .and_then(|out| String::from_utf8(out.stdout).ok())
                .unwrap_or_default()
        } else {
            String::new()
        };

        let capped_diff = if git_diff.chars().count() > 8_000 {
            let prefix: String = git_diff.chars().take(8_000).collect();
            format!("{}\n\n[Diff truncated for rapid review]", prefix)
        } else {
            git_diff
        };

        let tools_text = if tool_actions.is_empty() {
            "(No tools invoked)".to_string()
        } else {
            // Keep at most last 8 tool actions to stay ultra-compact
            let start = tool_actions.len().saturating_sub(8);
            tool_actions[start..].join("\n")
        };

        let system_prompt = "You are OpenPI Critic. Inspect code changes against the user's goal with extreme skepticism and high speed.\n\
Output format (MUST strictly follow):\n\
STATUS: APPROVED (or STATUS: REJECTED)\n\
CRITIQUE: <1-2 concise bullet points if rejected, or 1 brief sentence if approved>";

        let user_content = format!(
            "### User Goal:\n{}\n\n### Primary Agent Answer:\n{}\n\n### Tool Actions:\n{}\n\n### Git Diff:\n{}",
            user_prompt, actor_reply, tools_text, if capped_diff.trim().is_empty() { "(No code diffs)" } else { &capped_diff }
        );

        struct NullHandler;
        impl StreamEventHandler for NullHandler {}

        let messages = vec![
            ChatMessage::system(system_prompt),
            ChatMessage::user(user_content),
        ];

        // Fast generation: limit max_tokens to 256 for rapid response
        let mut fast_rev_cfg = rev_cfg.clone();
        fast_rev_cfg.max_tokens = 256;

        let fut = llm.stream_chat_completion(
            &fast_rev_cfg,
            messages,
            None,
            cancel_token,
            &NullHandler,
        );

        // Fast 12s timeout (down from 35s)
        let res = tokio::time::timeout(std::time::Duration::from_secs(12), fut).await??;
        let text = res.text.trim();
        let (approved, critique) = parse_review_output(text);

        Ok(ReviewResult {
            approved,
            critique,
            reviewer_id: rev_cfg.id.clone(),
            provider_id: rev_cfg.provider.clone(),
        })
    }

    pub async fn run_turn(
        &self,
        session_id: &str,
        user_prompt: &str,
        cwd: &str,
        model_override: Option<&str>,
        cancel_token: CancellationToken,
    ) -> Result<()> {
        let _ = self.reload_config();
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

        // 1-based turn index within the session, used to sample background work.
        let turn_number = history.iter().filter(|m| m.role == "user").count() as u64 + 1;

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
        let personal_directive = crate::build_personal_context_directive(cwd, user_prompt);

        let system_prompt = format!(
            "You are OpenPI, an autonomous AI software engineer running on the native Rust engine (openpi-engine).\n\
             Workspace: {}\n\
             Principles:\n\
             1. Fast, surgical execution: use read to inspect files, edit/search_replace to perform minimal atomic updates, and bash to test or run commands.\n\
             2. Be decisive and efficient: avoid redundant repeated searches, excessive read cycles, or unnecessary multiple rounds of verification. When the target code or root cause is clear, make the edit directly.\n\
             3. Never run broad recursive searches across the home directory; use targeted grep or find instead.\n\
             4. Decisive reasoning: Keep your chain of thought concise, goal-oriented, and analytical. Never repeat identical thoughts, loops of deliberation, or stall before action. Once a plan or step is decided, immediately proceed to tool calls or response.\n\
             5. [Dream-RSI Prior ({}, Beta* = {:.2})]: Focus strictly on solving the assigned task with low churn and high precision.{}{}{}",
            cwd, ctx_label, beta, persona_directive, skills_directive, personal_directive
        );

        active_messages.push(ChatMessage::system(system_prompt));
        active_messages.extend(history);
        active_messages.push(ChatMessage::user(user_prompt));

        let tool_defs = self.tool_registry.stable_definitions();

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

        let mut modified_code = false;
        let mut tool_actions_summary: Vec<String> = Vec::new();
        let mut review_attempts: usize = 0;
        const MAX_REVIEW_RETRIES: usize = 2;

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

            // 上游 1.0.1 Prompt Cache Preservation:
            // 严禁颠倒或随机修改前缀，保持消息链头部与工具列表绝对前缀一致，仅尾部递增
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
            let cache_read_tok = llm_res.usage.as_ref().map(|u| u.cache_read_tokens()).unwrap_or(0);
            let cache_write_tok = llm_res.usage.as_ref().map(|u| u.cache_creation_tokens()).unwrap_or(0);

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
                    cache_read_tok,
                    cache_write_tok,
                    "toolUse",
                )?;

                let mut asst_msg = ChatMessage::assistant(&llm_res.text);
                if llm_res.text.trim().is_empty() {
                    // OpenAI-compatible APIs expect `content: null` (not "") on an
                    // assistant message that only carries tool calls.
                    asst_msg.content = None;
                }
                if !llm_res.reasoning.trim().is_empty() {
                    asst_msg.reasoning_content = Some(llm_res.reasoning.clone());
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

                    let tool_name = tc.function.name.as_str();
                    if matches!(tool_name, "edit" | "write" | "search_replace" | "bash" | "managed_bash") {
                        modified_code = true;
                    }
                    let summary_str = format!("{}: {}", tool_name, parsed_args);
                    let capped_summary: String = summary_str.chars().take(200).collect();
                    tool_actions_summary.push(capped_summary);

                    // Append tool result to journal and context
                    journal.append_tool_result(
                        &tc.id,
                        &tc.function.name,
                        &exec_result.output,
                        exec_result.is_error,
                    )?;

                    // ActKV bypass: offload tool output if it exceeds 16KB to prevent
                    // blowing up LLM context window, while journal retains full output.
                    const MAX_TOOL_INLINE_BYTES: usize = 16 * 1024;
                    let (tool_msg, _offloaded) = ChatMessage::tool_result_with_bypass(
                        &tc.id,
                        &exec_result.output,
                        MAX_TOOL_INLINE_BYTES,
                    );
                    active_messages.push(tool_msg);
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
                    cache_read_tok,
                    cache_write_tok,
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
                // Primary agent generated a final textual response (no further tool calls).
                // Before settling, check if a third-party review is configured & warranted.
                let reviewer_model_opt = {
                    let r = self.config.read().ok();
                    r.and_then(|c| {
                        if c.reviewer.enabled && (c.reviewer.mode == "always" || modified_code || review_attempts > 0) {
                            c.resolve_reviewer_model()
                        } else {
                            None
                        }
                    })
                };

                let execution_mode = {
                    let r = self.config.read().ok();
                    r.map(|c| c.reviewer.execution_mode.clone()).unwrap_or_else(|| "async".into())
                };

                if execution_mode != "blocking" {
                    // ⚡ 【非阻塞后台异步质检模式】(Async Mode): 立即交付主回答，绝不阻塞用户任务与交互输入
                    journal.append_assistant_message(
                        &llm_res.text,
                        &llm_res.reasoning,
                        &[],
                        &model_cfg.provider,
                        &model_cfg.id,
                        in_tok,
                        out_tok,
                        cache_read_tok,
                        cache_write_tok,
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

                    // 后台并发执行独立质检，速度快且完全不拖慢交互
                    if let Some(rev_cfg) = reviewer_model_opt {
                        let event_tx = self.event_tx.clone();
                        let llm_client = self.llm_client.clone();
                        let session_id_str = session_id.to_string();
                        let user_prompt_str = user_prompt.to_string();
                        let actor_reply_str = llm_res.text.clone();
                        let tool_actions = tool_actions_summary.clone();
                        let cwd_str = cwd.to_string();
                        let cancel_token = cancel_token.clone();

                        tokio::spawn(async move {
                            let _ = event_tx.send((
                                session_id_str.clone(),
                                json!({
                                    "type": "review_start",
                                    "reviewer": rev_cfg.id,
                                    "provider": rev_cfg.provider,
                                    "mode": "async",
                                    "attempt": 1
                                }),
                            ));

                            match Self::execute_review(
                                &llm_client,
                                &rev_cfg,
                                &user_prompt_str,
                                &actor_reply_str,
                                &tool_actions,
                                &cwd_str,
                                cancel_token,
                            ).await {
                                Ok(rev_res) => {
                                    let _ = event_tx.send((
                                        session_id_str.clone(),
                                        json!({
                                            "type": "review_result",
                                            "reviewer": rev_cfg.id,
                                            "provider": rev_cfg.provider,
                                            "status": if rev_res.approved { "approved" } else { "rejected" },
                                            "critique": rev_res.critique,
                                            "mode": "async",
                                            "attempt": 1
                                        }),
                                    ));

                                    if !rev_res.approved {
                                        info!(
                                            "Session {} async review rejected by {}: {}",
                                            session_id_str, rev_cfg.id, rev_res.critique
                                        );
                                        let mut bg_journal = SessionJournal::open(&session_id_str);
                                        let critique_text = format!(
                                            "⚠️ [第三方独立评审 ({}) 质检建议]:\n{}",
                                            rev_cfg.id, rev_res.critique
                                        );
                                        let _ = bg_journal.append_assistant_message(
                                            &critique_text,
                                            "",
                                            &[],
                                            &rev_cfg.provider,
                                            &rev_cfg.id,
                                            0, 0, 0, 0,
                                            "critique_rejected",
                                        );
                                    } else {
                                        info!(
                                            "Session {} async review approved by {}: {}",
                                            session_id_str, rev_cfg.id, rev_res.critique
                                        );
                                    }
                                }
                                Err(e) => {
                                    warn!("Session {} async review failed: {}. Automatically bypassed.", session_id_str, e);
                                    let _ = event_tx.send((
                                        session_id_str.clone(),
                                        json!({
                                            "type": "review_result",
                                            "reviewer": rev_cfg.id,
                                            "provider": rev_cfg.provider,
                                            "status": "bypassed",
                                            "critique": format!("评审调用异常 (已自动放行): {}", e),
                                            "mode": "async",
                                            "attempt": 1
                                        }),
                                    ));
                                }
                            }
                        });
                    }

                    finished_normally = true;
                    break;
                }

                // 🛑 【同步严格门禁模式】(Blocking Mode): 仅在用户显式要求严格门禁时阻断等待
                if let Some(rev_cfg) = reviewer_model_opt {
                    if review_attempts < MAX_REVIEW_RETRIES {
                        info!(
                            "Triggering blocking third-party review ({}/{}) for session {}, attempt {}/{}",
                            rev_cfg.provider, rev_cfg.id, session_id, review_attempts + 1, MAX_REVIEW_RETRIES
                        );

                        let _ = self.event_tx.send((
                            session_id.to_string(),
                            json!({
                                "type": "review_start",
                                "reviewer": rev_cfg.id,
                                "provider": rev_cfg.provider,
                                "mode": "blocking",
                                "attempt": review_attempts + 1
                            }),
                        ));

                        let review_fut = Self::execute_review(
                            &self.llm_client,
                            &rev_cfg,
                            user_prompt,
                            &llm_res.text,
                            &tool_actions_summary,
                            cwd,
                            cancel_token.clone(),
                        );

                        match review_fut.await {
                            Ok(rev_res) => {
                                let _ = self.event_tx.send((
                                    session_id.to_string(),
                                    json!({
                                        "type": "review_result",
                                        "reviewer": rev_cfg.id,
                                        "provider": rev_cfg.provider,
                                        "status": if rev_res.approved { "approved" } else { "rejected" },
                                        "critique": rev_res.critique,
                                        "mode": "blocking",
                                        "attempt": review_attempts + 1
                                    }),
                                ));

                                if !rev_res.approved {
                                    review_attempts += 1;
                                    warn!(
                                        "Session {} review rejected by {}: {}",
                                        session_id, rev_cfg.id, rev_res.critique
                                    );

                                    // Record the intermediate assistant answer to journal
                                    let _ = journal.append_assistant_message(
                                        &llm_res.text,
                                        &llm_res.reasoning,
                                        &[],
                                        &model_cfg.provider,
                                        &model_cfg.id,
                                        in_tok,
                                        out_tok,
                                        cache_read_tok,
                                        cache_write_tok,
                                        "critique_rejected",
                                    );

                                    let mut asst_msg = ChatMessage::assistant(&llm_res.text);
                                    if !llm_res.reasoning.trim().is_empty() {
                                        asst_msg.reasoning_content = Some(llm_res.reasoning.clone());
                                    }
                                    active_messages.push(asst_msg);

                                    let critique_prompt = format!(
                                        "[第三方独立模型评审 ({}) 质检未通过 - 驳回修正]:\n\n{}\n\n请针对上述审查意见进行修改和补充验证，消除缺陷后再完成本轮任务。严禁盲目自信或未经验证假装完成。",
                                        rev_cfg.id, rev_res.critique
                                    );
                                    active_messages.push(ChatMessage::user(critique_prompt));

                                    // Continue the cognitive turn loop! Actor will generate tool calls to fix defects.
                                    continue;
                                } else {
                                    info!(
                                        "Session {} review approved by {}: {}",
                                        session_id, rev_cfg.id, rev_res.critique
                                    );
                                }
                            }
                            Err(e) => {
                                warn!("Session {} review call failed: {}. Continuing without blocking turn.", session_id, e);
                                let _ = self.event_tx.send((
                                    session_id.to_string(),
                                    json!({
                                        "type": "review_result",
                                        "reviewer": rev_cfg.id,
                                        "provider": rev_cfg.provider,
                                        "status": "bypassed",
                                        "critique": format!("评审调用异常 (已自动放行): {}", e),
                                        "mode": "blocking",
                                        "attempt": review_attempts + 1
                                    }),
                                ));
                            }
                        }
                    }
                }

                // Final textual response for blocking mode (either approved or not applicable)
                journal.append_assistant_message(
                    &llm_res.text,
                    &llm_res.reasoning,
                    &[],
                    &model_cfg.provider,
                    &model_cfg.id,
                    in_tok,
                    out_tok,
                    cache_read_tok,
                    cache_write_tok,
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
                    let cache_read_tok = res.usage.as_ref().map(|u| u.cache_read_tokens()).unwrap_or(0);
                    let cache_write_tok = res.usage.as_ref().map(|u| u.cache_creation_tokens()).unwrap_or(0);

                    let _ = journal.append_assistant_message(
                        &synth_text,
                        &res.reasoning,
                        &[],
                        &model_cfg.provider,
                        &model_cfg.id,
                        in_tok,
                        out_tok,
                        cache_read_tok,
                        cache_write_tok,
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

        // 7. Trigger Autonomous Memory Stage 1 thread extraction. Sampled rather
        // than per-turn, and skipped for casual chatter: it re-summarizes the whole
        // session with an LLM call, so firing it every turn was pure overhead.
        if (turn_number == 1 || turn_number.is_multiple_of(BACKGROUND_TURN_INTERVAL))
            && !crate::memory_worker::is_casual_noise(user_prompt)
        {
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
        }

        // 8. Trigger Autonomous Title Summarization and broadcast if refined.
        // The first couple of turns get a chance to name the session; after that
        // it is sampled instead of re-summarized on every turn.
        if turn_number <= 2 || turn_number.is_multiple_of(BACKGROUND_TURN_INTERVAL) {
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
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ChatMessage, FunctionCall, ToolCall};

    fn tool_result_of(len: usize) -> ChatMessage {
        ChatMessage::tool_result("c", "x".repeat(len))
    }

    fn assistant_with_tool_call() -> ChatMessage {
        let mut m = ChatMessage::assistant("");
        m.tool_calls = Some(vec![ToolCall {
            id: "c".into(),
            r#type: "function".into(),
            function: FunctionCall {
                name: "bash".into(),
                arguments: "{}".into(),
            },
        }]);
        m
    }

    #[test]
    fn compact_folds_only_the_older_tool_results() {
        // Three tool results; the newest two must stay verbatim while the older one
        // is folded. This bounds the context an in-flight turn carries into the next
        // LLM call, so a regression here directly inflates per-call cost.
        let mut messages = vec![
            ChatMessage::user("go"),
            assistant_with_tool_call(),
            tool_result_of(2000), // oldest -> folded
            assistant_with_tool_call(),
            tool_result_of(2000), // newest two -> kept
            assistant_with_tool_call(),
            tool_result_of(2000),
        ];
        AgentLoop::compact_inflight_messages(&mut messages);

        let text_of = |m: &ChatMessage| match &m.content {
            Some(crate::protocol::ChatContent::Text(t)) => t.clone(),
            _ => String::new(),
        };
        assert!(text_of(&messages[2]).contains("已折叠"), "oldest result should be folded");
        assert_eq!(text_of(&messages[4]).chars().count(), 2000, "recent result must be intact");
        assert_eq!(text_of(&messages[6]).chars().count(), 2000, "newest result must be intact");
    }

    #[test]
    fn compact_folds_older_reasoning_but_keeps_the_recent_steps() {
        // Reasoning is resent to the provider on every call within the turn, so
        // old scratchpad must be folded while the newest steps stay intact.
        let mut older = assistant_with_tool_call();
        older.reasoning_content = Some("R".repeat(9_000));
        let mut recent = assistant_with_tool_call();
        recent.reasoning_content = Some("S".repeat(9_000));

        let mut messages = vec![
            ChatMessage::user("go"),
            older,               // before the last two results -> folded
            tool_result_of(500),
            assistant_with_tool_call(),
            tool_result_of(500),
            recent,              // after the cutoff -> kept
            tool_result_of(500),
        ];
        AgentLoop::compact_inflight_messages(&mut messages);

        let older_r = messages[1].reasoning_content.as_ref().unwrap();
        assert!(older_r.contains("已省略"), "older reasoning should be folded");
        assert_eq!(
            messages[5].reasoning_content.as_ref().unwrap().chars().count(),
            9_000,
            "recent reasoning must stay intact"
        );
    }

    #[test]
    fn compact_leaves_two_or_fewer_tool_results_untouched() {
        let mut messages = vec![
            assistant_with_tool_call(),
            tool_result_of(5000),
            assistant_with_tool_call(),
            tool_result_of(5000),
        ];
        AgentLoop::compact_inflight_messages(&mut messages);
        for m in [&messages[1], &messages[3]] {
            if let Some(crate::protocol::ChatContent::Text(t)) = &m.content {
                assert_eq!(t.chars().count(), 5000);
            }
        }
    }

    #[test]
    fn test_parse_review_output_approved_and_rejected() {
        let text_approved = "STATUS: APPROVED\nSUMMARY: Code is clean and tests pass.";
        let (ok, out) = parse_review_output(text_approved);
        assert!(ok);
        assert_eq!(out, text_approved);

        let text_rejected = "STATUS: REJECTED\nDEFECTS:\n- [Null pointer]: Line 42 does not check None.";
        let (ok2, out2) = parse_review_output(text_rejected);
        assert!(!ok2);
        assert_eq!(out2, text_rejected);

        let text_defects_only = "Found issues:\nDEFECTS:\n- Unhandled error in file reader.";
        let (ok3, _) = parse_review_output(text_defects_only);
        assert!(!ok3);

        let text_flaws = "Here are the flaws:\n- Incorrect port binding";
        let (ok4, _) = parse_review_output(text_flaws);
        assert!(!ok4);

        let text_lowercase = "status: rejected\ndefects: broken logic";
        let (ok5, _) = parse_review_output(text_lowercase);
        assert!(!ok5);

        let text_normal = "Looks completely fine, all requirements met.";
        let (ok6, _) = parse_review_output(text_normal);
        assert!(ok6);
    }
}
