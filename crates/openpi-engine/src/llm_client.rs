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

        let req_body = ChatCompletionRequest {
            model: config.id.clone(),
            messages,
            tools,
            stream: true,
            max_tokens: Some(config.max_tokens),
            temperature: Some(0.2),
            stream_options: Some(StreamOptions {
                include_usage: true,
            }),
        };

        debug!("Posting chat completion request to: {}", url);

        let mut attempts = 0;
        let max_attempts = 3;
        let mut response_opt = None;

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
                                            handler.on_reasoning_start();
                                        }
                                        accumulated_reasoning.push_str(&rc);
                                        handler.on_reasoning_delta(&rc);
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
