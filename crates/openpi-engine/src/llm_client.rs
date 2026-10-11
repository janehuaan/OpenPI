use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use std::collections::HashMap;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, warn};

use crate::config::ModelConfig;
use crate::protocol::{
    ChatCompletionChunk, ChatCompletionRequest, ChatMessage, FunctionCall,
    StreamOptions, TokenUsage, ToolCall, ToolDefinition,
};

#[derive(Debug, Clone)]
pub struct AccumulatedResponse {
    pub text: String,
    pub reasoning: String,
    pub tool_calls: Vec<ToolCall>,
    pub finish_reason: Option<String>,
    pub usage: Option<TokenUsage>,
}

#[derive(Clone)]
pub struct LlmClient {
    client: reqwest::Client,
}

/// Builds the streaming chat-completion payload.
///
/// Prompt caching: Anthropic-backed relays only populate
/// `prompt_tokens_details.cached_tokens` when the request carries an explicit
/// `cache_control` breakpoint, so without this the usage panel can only ever
/// report a 0% hit rate. `"promptCache": "off"` on the provider opts out.
///
/// Returns the body plus the `(index, original)` of the message we marked, so
/// the caller can roll the breakpoint back if the provider rejects it.
fn build_request_body(
    config: &ModelConfig,
    messages: Vec<ChatMessage>,
    tools: Option<Vec<ToolDefinition>>,
    temperature: Option<f32>,
    top_p: Option<f32>,
) -> (ChatCompletionRequest, Option<(usize, ChatMessage)>) {
    let mut messages = messages;
    let cache_breakpoint = if config.prompt_cache.enabled() {
        mark_system_cache_breakpoint(&mut messages)
    } else {
        None
    };
    let body = ChatCompletionRequest {
        model: config.id.clone(),
        messages,
        tools,
        stream: true,
        max_tokens: Some(config.max_tokens),
        temperature,
        top_p,
        stream_options: Some(StreamOptions {
            include_usage: true,
        }),
    };
    (body, cache_breakpoint)
}

/// Marks the last system/developer message as an Anthropic cache breakpoint.
/// Returns `(index, original)` so the caller can roll the change back if the
/// provider rejects the field.
fn mark_system_cache_breakpoint(messages: &mut [ChatMessage]) -> Option<(usize, ChatMessage)> {
    let idx = messages
        .iter()
        .rposition(|m| m.role == "system" || m.role == "developer")?;
    let original = messages[idx].clone();
    if messages[idx].mark_cache_breakpoint() {
        Some((idx, original))
    } else {
        None
    }
}

/// Determines if a model has reasoning/thinking capabilities.
pub fn is_reasoning_model(config: &ModelConfig) -> bool {
    if config.reasoning {
        return true;
    }
    let id = config.id.to_ascii_lowercase();
    id.contains("deepseek")
        || id.contains("r1")
        || id.contains("qwq")
        || id.contains("reasoner")
        || id.contains("thinking")
        || id.contains("o1")
        || id.contains("o3")
        || id.contains("o4")
}

/// Inspects reasoning text for degenerative autoregressive repetition loops.
/// Returns Some(pattern) if a repeating cycle is found.
pub fn detect_reasoning_repetition(text: &str) -> Option<String> {
    if text.len() < 30 {
        return None;
    }

    // 1. Line-based cyclic detection (catches multi-line loops like "OK.\nLet me write.\nGo.\nLet me write.")
    let lines: Vec<&str> = text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    let n = lines.len();
    if n >= 3 {
        // Test single line repeated 4 times consecutively (e.g. "Let me check." x 4)
        if n >= 4 && lines[n - 1] == lines[n - 2] && lines[n - 2] == lines[n - 3] && lines[n - 3] == lines[n - 4] {
            return Some(lines[n - 1].to_string());
        }

        // Test multi-line cycles of length k in 2..=8 repeated 3 times consecutively
        for k in 2..=8 {
            if n >= 3 * k {
                let block3 = &lines[n - k..n];
                let block2 = &lines[n - 2 * k..n - k];
                let block1 = &lines[n - 3 * k..n - 2 * k];
                if block1 == block2 && block2 == block3 {
                    return Some(block3.join("\n"));
                }
            }
        }
    }

    // 2. Substring window detection (catches inline or unformatted repeating loops)
    let tail_len = text.len().min(800);
    let mut tail_start = text.len() - tail_len;
    while !text.is_char_boundary(tail_start) {
        tail_start += 1;
    }
    let tail = &text[tail_start..];
    let bytes = tail.as_bytes();
    let m = bytes.len();

    let max_offset = 20.min(m.saturating_sub(30));
    for offset in 0..=max_offset {
        let end = m - offset;
        for w in 10..=120 {
            if end >= 3 * w {
                let chunk3 = &bytes[end - w..end];
                let chunk2 = &bytes[end - 2 * w..end - w];
                let chunk1 = &bytes[end - 3 * w..end - 2 * w];
                if chunk1 == chunk2 && chunk2 == chunk3 {
                    if let Ok(pat) = std::str::from_utf8(chunk3) {
                        let pat_trim = pat.trim();
                        if !pat_trim.is_empty() {
                            return Some(pat_trim.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

/// Truncates excessive duplicate cycles at the end of accumulated reasoning.
pub fn clean_repetitive_reasoning_tail(reasoning: &mut String, pattern: &str) {
    let trimmed_pat = pattern.trim();
    if trimmed_pat.is_empty() || reasoning.is_empty() {
        return;
    }

    // Find the first occurrence of the repeating pattern in the tail (last 4000 chars)
    let mut search_start = reasoning.len().saturating_sub(4000);
    while !reasoning.is_char_boundary(search_start) {
        search_start += 1;
    }

    if let Some(first_rel_pos) = reasoning[search_start..].find(trimmed_pat) {
        let keep_end = search_start + first_rel_pos + trimmed_pat.len();
        if keep_end < reasoning.len() && reasoning.is_char_boundary(keep_end) {
            reasoning.truncate(keep_end);
        }
    }
    reasoning.push_str("\n\n[OpenPI Guard: Terminated repetitive thinking loop]");
}

pub trait StreamEventHandler: Send + Sync {
    fn on_reasoning_start(&self) {}
    fn on_reasoning_delta(&self, _delta: &str) {}
    fn on_reasoning_end(&self) {}

    fn on_text_start(&self) {}
    fn on_text_delta(&self, _delta: &str) {}
    fn on_text_end(&self) {}

    fn on_tool_call_start(&self, _index: usize, _id: &str, _name: &str) {}
    fn on_tool_call_delta(&self, _index: usize, _id: &str, _delta: &str) {}
    fn on_tool_call_end(&self, _index: usize, _id: &str) {}
}

impl LlmClient {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(15))
            .tcp_keepalive(Duration::from_secs(60))
            .build()
            .expect("Failed to initialize HTTP client");
        Self { client }
    }

    pub async fn stream_chat_completion(
        &self,
        config: &ModelConfig,
        messages: Vec<ChatMessage>,
        tools: Option<Vec<ToolDefinition>>,
        cancel_token: CancellationToken,
        handler: &(dyn StreamEventHandler + 'static),
    ) -> Result<AccumulatedResponse> {
        let trimmed_base = config.base_url.trim().trim_end_matches('/');
        let url = if trimmed_base.ends_with("/chat/completions") {
            trimmed_base.to_string()
        } else {
            format!("{}/chat/completions", trimmed_base)
        };

        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if !config.api_key.is_empty() {
            let auth = format!("Bearer {}", config.api_key);
            if let Ok(val) = HeaderValue::from_str(&auth) {
                headers.insert(AUTHORIZATION, val);
            }
        }

        // 解析动态采样参数（Thinking Level 或默认温度）
        let is_reasoning = is_reasoning_model(config);
        let (default_temp, default_top_p) = if is_reasoning {
            (Some(0.6), Some(0.95))
        } else {
            (Some(0.2), None)
        };

        let (dyn_temperature, dyn_top_p) = if let Some(ref map) = config.sampling_params_by_thinking_level {
            let key = if is_reasoning { "high" } else { "normal" };
            if let Some(params) = map.get(key) {
                (params.temperature.or(default_temp), params.top_p.or(default_top_p))
            } else {
                (default_temp, default_top_p)
            }
        } else {
            (default_temp, default_top_p)
        };

        let (req_body, mut cache_breakpoint) =
            build_request_body(config, messages, tools, dyn_temperature, dyn_top_p);

        debug!("Posting chat completion request to: {}", url);

        let mut attempts = 0;
        let max_attempts = 3;
        let mut response_opt = None;
        let mut cache_retry_used = false;

        let mut req_body = req_body;
        while attempts < max_attempts {
            attempts += 1;
            let req_future = self.client.post(&url).headers(headers.clone()).json(&req_body).send();
            let res = tokio::select! {
                _ = cancel_token.cancelled() => {
                    bail!("LLM request cancelled by user");
                }
                res = req_future => res
            };

            match res {
                Ok(resp) => {
                    let status = resp.status();
                    if status.is_success() {
                        response_opt = Some(resp);
                        break;
                    } else if status.as_u16() == 400 && !cache_retry_used && cache_breakpoint.is_some() {
                        // A provider that validates strictly can reject the
                        // non-standard `cache_control` field. Roll it back and
                        // retry once so caching never becomes an outage — but
                        // only when the 400 is actually about caching, so an
                        // unrelated bad request does not burn a round trip.
                        let err_body = resp.text().await.unwrap_or_default();
                        if !is_cache_rejection(&err_body) {
                            error!("LLM API returned error 400: {}", err_body);
                            bail!("LLM API error (400): {}", err_body);
                        }
                        cache_retry_used = true;
                        if let Some((idx, original)) = cache_breakpoint.take() {
                            req_body.messages[idx] = original;
                        }
                        warn!(
                            "LLM provider rejected the cache_control breakpoint (HTTP 400); retrying without prompt caching. \
                             Set \"promptCache\": \"off\" on this provider to avoid the extra round trip."
                        );
                        continue;
                    } else if (status.as_u16() == 502 || status.as_u16() == 503 || status.as_u16() == 504 || status.as_u16() == 429) && attempts < max_attempts {
                        let err_body = resp.text().await.unwrap_or_default();
                        warn!("LLM API transient error {} (attempt {}/{}): {}, retrying in {}ms...", status, attempts, max_attempts, err_body, attempts * 1500);
                        tokio::time::sleep(Duration::from_millis(1500 * attempts as u64)).await;
                        continue;
                    } else {
                        let error_text = resp.text().await.unwrap_or_default();
                        error!("LLM API returned error {}: {}", status, error_text);
                        bail!("LLM API error ({}): {}", status, error_text);
                    }
                }
                Err(err) => {
                    if attempts < max_attempts && (err.is_timeout() || err.is_connect()) {
                        warn!("LLM network error (attempt {}/{}): {}, retrying in {}ms...", attempts, max_attempts, err, attempts * 1500);
                        tokio::time::sleep(Duration::from_millis(1500 * attempts as u64)).await;
                        continue;
                    } else {
                        bail!("Failed to connect to LLM provider at {}: {}", url, err);
                    }
                }
            }
        }

        let response = response_opt.ok_or_else(|| anyhow::anyhow!("LLM request failed after {} attempts", max_attempts))?;

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        let mut accumulated_text = String::new();
        let mut accumulated_reasoning = String::new();
        let mut reasoning_start_time: Option<std::time::Instant> = None;
        let mut loop_detected_pattern: Option<String> = None;
        // Streaming tool calls are accumulated in arrival order. `index` is only a
        // grouping hint, and some OpenAI-compatible gateways reuse the same index
        // (often 0) for every call — so we additionally split by `id` to avoid
        // merging distinct calls into a single broken invocation.
        let mut tool_calls_map: HashMap<usize, usize> = HashMap::new(); // stream index -> position in tool_calls_vec
        let mut tool_calls_vec: Vec<(String, String, String)> = Vec::new(); // (id, name, args)
        let mut finish_reason: Option<String> = None;
        let mut usage: Option<TokenUsage> = None;

        let mut in_reasoning = false;
        let mut in_text = false;
        let mut stream_done = false;

        'stream_loop: while let Some(chunk_res) = tokio::select! {
            _ = cancel_token.cancelled() => {
                bail!("LLM stream cancelled by user");
            }
            res = tokio::time::timeout(Duration::from_secs(180), stream.next()) => {
                match res {
                    Ok(next) => next,
                    Err(_) => {
                        warn!("LLM stream inactive for 180s, stream read timed out");
                        if !stream_done {
                            bail!("LLM stream timed out after 180s of inactivity from provider (interrupted generation)");
                        }
                        None
                    }
                }
            }
        } {
            let chunk = chunk_res.context("Error reading response stream chunk from LLM")?;
            let chunk_str = String::from_utf8_lossy(&chunk);
            buffer.push_str(&chunk_str);

            while let Some(newline_pos) = buffer.find('\n') {
                let line = buffer[..newline_pos].trim_end_matches('\r').to_string();
                buffer.drain(..=newline_pos);

                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with(':') {
                    continue;
                }

                if let Some(data) = trimmed.strip_prefix("data: ") {
                    let data = data.trim();
                    if data == "[DONE]" {
                        stream_done = true;
                        break;
                    }

                    match serde_json::from_str::<ChatCompletionChunk>(data) {
                        Ok(chunk) => {
                            if let Some(u) = chunk.usage {
                                usage = Some(u);
                            }

                            for choice in chunk.choices {
                                if let Some(fr) = choice.finish_reason {
                                    if fr == "stop" || fr == "length" || fr == "tool_calls" || fr == "function_call" {
                                        stream_done = true;
                                    }
                                    finish_reason = Some(fr);
                                }

                                // 1. Reasoning / Thinking delta
                                let reasoning_chunk = choice
                                    .delta
                                    .reasoning_content
                                    .or(choice.delta.reasoning)
                                    .or(choice.delta.thought);

                                if let Some(rc) = reasoning_chunk {
                                    if !rc.is_empty() {
                                        if !in_reasoning {
                                            in_reasoning = true;
                                            reasoning_start_time = Some(std::time::Instant::now());
                                            handler.on_reasoning_start();
                                        }
                                        accumulated_reasoning.push_str(&rc);
                                        handler.on_reasoning_delta(&rc);

                                        // Safety guard 1: Check for degenerative repetition loop
                                        if accumulated_reasoning.len() > 60 {
                                            if let Some(pat) = detect_reasoning_repetition(&accumulated_reasoning) {
                                                warn!(
                                                    "OpenPI Guard: Degenerative reasoning repetition loop detected (pattern: {:?}). Breaking stream early.",
                                                    pat
                                                );
                                                loop_detected_pattern = Some(pat);
                                                stream_done = true;
                                                break 'stream_loop;
                                            }
                                        }

                                        // Safety guard 2: Reasoning time budget cap (75s)
                                        if let Some(st) = reasoning_start_time {
                                            if st.elapsed().as_secs() >= 75 {
                                                warn!("OpenPI Guard: Reasoning stream exceeded 75s budget. Breaking stream early.");
                                                stream_done = true;
                                                break 'stream_loop;
                                            }
                                        }

                                        // Safety guard 3: Reasoning character cap (40k chars)
                                        if accumulated_reasoning.len() >= 40_000 {
                                            warn!("OpenPI Guard: Reasoning stream exceeded 40,000 characters cap. Breaking stream early.");
                                            stream_done = true;
                                            break 'stream_loop;
                                        }
                                    }
                                }

                                // 2. Content delta
                                if let Some(c) = choice.delta.content {
                                    if !c.is_empty() {
                                        if in_reasoning {
                                            in_reasoning = false;
                                            handler.on_reasoning_end();
                                        }
                                        if !in_text {
                                            in_text = true;
                                            handler.on_text_start();
                                        }
                                        accumulated_text.push_str(&c);
                                        handler.on_text_delta(&c);
                                    }
                                }

                                // 3. Tool calls delta
                                if let Some(tcs) = choice.delta.tool_calls {
                                    if in_reasoning {
                                        in_reasoning = false;
                                        handler.on_reasoning_end();
                                    }
                                    if in_text {
                                        in_text = false;
                                        handler.on_text_end();
                                    }

                                    for tc in tcs {
                                        let incoming_id = tc.id.clone().filter(|s| !s.is_empty());

                                        let existing = tool_calls_map.get(&tc.index).copied();
                                        // A new tool call has started when the incoming id
                                        // differs from the entry currently owning this index.
                                        let starts_new = matches!(
                                            (existing, incoming_id.as_ref()),
                                            (Some(pos), Some(id)) if tool_calls_vec[pos].0 != *id
                                        );

                                        let pos = match existing {
                                            Some(existing_pos) if !starts_new => existing_pos,
                                            _ => {
                                                let p = tool_calls_vec.len();
                                                let id = incoming_id.clone().unwrap_or_else(|| {
                                                    format!("call_{}_{}", tc.index, uuid::Uuid::new_v4().simple())
                                                });
                                                tool_calls_vec.push((id, String::new(), String::new()));
                                                tool_calls_map.insert(tc.index, p);
                                                p
                                            }
                                        };

                                        if let Some(id) = incoming_id {
                                            tool_calls_vec[pos].0 = id;
                                        }

                                        if let Some(fn_call) = tc.function {
                                            if let Some(name) = fn_call.name {
                                                if !name.is_empty() {
                                                    tool_calls_vec[pos].1.push_str(&name);
                                                    let id = tool_calls_vec[pos].0.clone();
                                                    let acc_name = tool_calls_vec[pos].1.clone();
                                                    handler.on_tool_call_start(tc.index, &id, &acc_name);
                                                }
                                            }
                                            if let Some(args_chunk) = fn_call.arguments {
                                                if !args_chunk.is_empty() {
                                                    tool_calls_vec[pos].2.push_str(&args_chunk);
                                                    let id = tool_calls_vec[pos].0.clone();
                                                    handler.on_tool_call_delta(tc.index, &id, &args_chunk);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            warn!("Failed to parse SSE JSON chunk: {} (raw: {})", e, data);
                        }
                    }
                }
            }

            if stream_done {
                break 'stream_loop;
            }
        }

        if let Some(ref pat) = loop_detected_pattern {
            clean_repetitive_reasoning_tail(&mut accumulated_reasoning, pat);
        } else if accumulated_reasoning.len() >= 40_000 {
            accumulated_reasoning.push_str("\n\n[OpenPI Guard: Terminated excessive thinking (budget cap reached)]");
        } else if reasoning_start_time.map(|st| st.elapsed().as_secs() >= 75).unwrap_or(false)
            && accumulated_text.is_empty()
            && tool_calls_vec.is_empty()
        {
            accumulated_reasoning.push_str("\n\n[OpenPI Guard: Terminated excessive thinking (75s time budget reached)]");
        }

        if !stream_done && accumulated_text.is_empty() && tool_calls_vec.is_empty() {
            bail!("LLM stream closed prematurely by provider without returning any content or tool calls");
        }

        if in_reasoning {
            handler.on_reasoning_end();
        }
        if in_text {
            handler.on_text_end();
        }

        // Notify tool call ends (arrival order, which matches the model's call order)
        let mut tool_calls = Vec::new();
        for (index, (id, name, args)) in tool_calls_vec.into_iter().enumerate() {
            handler.on_tool_call_end(index, &id);
            tool_calls.push(ToolCall {
                id,
                r#type: "function".into(),
                function: FunctionCall {
                    name,
                    arguments: args,
                },
            });
        }

        Ok(AccumulatedResponse {
            text: accumulated_text,
            reasoning: accumulated_reasoning,
            tool_calls,
            finish_reason,
            usage,
        })
    }
}

impl Default for LlmClient {
    fn default() -> Self {
        Self::new()
    }
}

/// Whether an HTTP 400 body points at the `cache_control` field specifically.
/// Providers phrase it differently, so a few spellings are accepted; anything
/// else must NOT trigger the rollback retry (an unrelated 400 should fail fast).
fn is_cache_rejection(body: &str) -> bool {
    let lower = body.to_ascii_lowercase();
    lower.contains("cache_control") || lower.contains("cach_control") || lower.contains("cachecontrol")
}

#[cfg(test)]
mod prompt_cache_tests {
    use super::*;
    use crate::config::PromptCacheMode;

    fn model(prompt_cache: PromptCacheMode) -> ModelConfig {
        ModelConfig {
            id: "gemini-3.8-flash-high".into(),
            name: None,
            provider: "自建".into(),
            base_url: "https://example.test/v1".into(),
            api_key: "k".into(),
            context_window: 1_000_000,
            max_tokens: 4096,
            reasoning: true,
            sampling_params_by_thinking_level: None,
            prompt_cache,
        }
    }

    fn messages() -> Vec<ChatMessage> {
        vec![
            ChatMessage::system("system prompt"),
            ChatMessage::user("hello"),
            ChatMessage::assistant("hi"),
            ChatMessage::user("again"),
        ]
    }

    #[test]
    fn cache_breakpoint_lands_on_the_system_message_only() {
        let (body, mark) = build_request_body(&model(PromptCacheMode::Auto), messages(), None, Some(0.2), None);
        assert!(mark.is_some());
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(
            v["messages"][0]["content"],
            serde_json::json!([{ "type": "text", "text": "system prompt",
                                 "cache_control": { "type": "ephemeral" } }])
        );
        // Everything after the system message must stay byte-identical, so the
        // cached prefix is not perturbed.
        assert_eq!(v["messages"][1]["content"], serde_json::json!("hello"));
        assert_eq!(v["messages"][3]["content"], serde_json::json!("again"));
    }

    #[test]
    fn prompt_cache_off_sends_no_breakpoint() {
        let (body, mark) = build_request_body(&model(PromptCacheMode::Off), messages(), None, None, None);
        assert!(mark.is_none());
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v["messages"][0]["content"], serde_json::json!("system prompt"));
        assert!(v.to_string().find("cache_control").is_none());
    }

    #[test]
    fn rolling_the_breakpoint_back_restores_the_original_payload() {
        let (mut body, mark) = build_request_body(&model(PromptCacheMode::Auto), messages(), None, None, None);
        let (idx, original) = mark.expect("breakpoint should be set");
        body.messages[idx] = original;
        let v = serde_json::to_value(&body).unwrap();
        assert_eq!(v["messages"][0]["content"], serde_json::json!("system prompt"));
    }

    #[test]
    fn a_conversation_without_a_system_message_is_untouched() {
        let msgs = vec![ChatMessage::user("hello"), ChatMessage::assistant("hi")];
        let (body, mark) = build_request_body(&model(PromptCacheMode::Auto), msgs, None, None, None);
        assert!(mark.is_none());
        let v = serde_json::to_value(&body).unwrap();
        assert!(v.to_string().find("cache_control").is_none());
    }
}

#[cfg(test)]
mod reasoning_guard_tests {
    use super::*;

    #[test]
    fn test_is_reasoning_model_detection() {
        let mut cfg = ModelConfig {
            id: "cline-pass/deepseek-v4.1-flash".into(),
            name: None,
            provider: "gateway".into(),
            base_url: "http://127.0.0.1:8788/v1".into(),
            api_key: "k".into(),
            context_window: 128_000,
            max_tokens: 4096,
            reasoning: false, // Notice false in config, but id is deepseek!
            sampling_params_by_thinking_level: None,
            prompt_cache: crate::config::PromptCacheMode::Auto,
        };
        assert!(is_reasoning_model(&cfg));

        cfg.id = "openai/gpt-4o".into();
        assert!(!is_reasoning_model(&cfg));

        cfg.reasoning = true;
        assert!(is_reasoning_model(&cfg));
    }

    #[test]
    fn test_detect_multi_line_repetition_loop() {
        // Exactly matching the user's screenshot pattern:
        let repetition_sample = "Let me think about how to solve this.\n\
OK.\n\
Let me write.\n\
Go.\n\
Let me write.\n\
OK.\n\
Let me write.\n\
Go.\n\
Let me write.\n\
OK.\n\
Let me write.\n\
Go.\n\
Let me write.";

        let detected = detect_reasoning_repetition(repetition_sample);
        assert!(detected.is_some(), "Should detect the 4-line 3-cycle repetition loop");
        let pattern = detected.unwrap();
        assert!(pattern.contains("OK."));
        assert!(pattern.contains("Let me write."));

        let mut cleaned = repetition_sample.to_string();
        clean_repetitive_reasoning_tail(&mut cleaned, &pattern);
        assert!(cleaned.contains("[OpenPI Guard: Terminated repetitive thinking loop]"));
        // Ensure earlier reasoning was preserved
        assert!(cleaned.contains("Let me think about how to solve this."));
        // Ensure redundant repetitions were stripped (should contain OK only once)
        assert_eq!(cleaned.matches("OK.").count(), 1);
    }

    #[test]
    fn test_detect_single_line_repetition() {
        let text = "Analyzing files...\nLet me check again.\nLet me check again.\nLet me check again.\nLet me check again.";
        let detected = detect_reasoning_repetition(text);
        assert!(detected.is_some());
        assert_eq!(detected.unwrap(), "Let me check again.");

        let mut cleaned = text.to_string();
        clean_repetitive_reasoning_tail(&mut cleaned, "Let me check again.");
        assert_eq!(cleaned.matches("Let me check again.").count(), 1);
        assert!(cleaned.contains("[OpenPI Guard: Terminated repetitive thinking loop]"));
    }

    #[test]
    fn test_detect_substring_inline_repetition() {
        let text = "Initial steps. Hello world from loop! Hello world from loop! Hello world from loop! ";
        let detected = detect_reasoning_repetition(text);
        assert!(detected.is_some());
        assert!(detected.unwrap().contains("Hello world from loop!"));
    }

    #[test]
    fn test_normal_reasoning_does_not_trigger_false_positives() {
        let normal_thought = "First, I will read the file crates/openpi-engine/src/lib.rs.\n\
Then I will check if the module is registered.\n\
Next, I will compile using cargo test.\n\
Everything looks good, ready to edit.";
        assert!(detect_reasoning_repetition(normal_thought).is_none());
    }
}

#[test]
fn only_cache_related_400s_trigger_the_rollback_retry() {
    assert!(is_cache_rejection(
        r#"{"error":{"message":"cache_control: Field 'content[0].cache_control' is not supported"}}"#
    ));
    assert!(is_cache_rejection("Invalid request: unknown field cachecontrol"));
    // Unrelated 400s must fail fast instead of burning a retry round trip.
    assert!(!is_cache_rejection(r#"{"error":{"message":"max_tokens is too large"}}"#));
    assert!(!is_cache_rejection(""));
}
