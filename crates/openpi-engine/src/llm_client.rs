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
        let mut url = format!("{}/chat/completions", config.base_url);
        // Clean double slashes
        if url.contains("//chat") {
            url = url.replace("//chat", "/chat");
        }

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

        let response = tokio::select! {
            _ = cancel_token.cancelled() => {
                bail!("LLM request cancelled by user");
            }
            res = self.client.post(&url).headers(headers).json(&req_body).send() => {
                res.with_context(|| format!("Failed to connect to LLM provider at {}", url))?
            }
        };

        let status = response.status();
        if !status.is_success() {
            let error_text = response.text().await.unwrap_or_default();
            error!("LLM API returned error {}: {}", status, error_text);
            bail!("LLM API error ({}): {}", status, error_text);
        }

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        let mut accumulated_text = String::new();
        let mut accumulated_reasoning = String::new();
        let mut tool_calls_map: HashMap<usize, (String, String, String)> = HashMap::new(); // index -> (id, name, args)
        let mut finish_reason: Option<String> = None;
        let mut usage: Option<TokenUsage> = None;

        let mut in_reasoning = false;
        let mut in_text = false;

        while let Some(chunk_res) = tokio::select! {
            _ = cancel_token.cancelled() => {
                bail!("LLM stream cancelled by user");
            }
            next = stream.next() => next
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
                        break;
                    }

                    match serde_json::from_str::<ChatCompletionChunk>(data) {
                        Ok(chunk) => {
                            if let Some(u) = chunk.usage {
                                usage = Some(u);
                            }

                            for choice in chunk.choices {
                                if let Some(fr) = choice.finish_reason {
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
                                        let entry = tool_calls_map.entry(tc.index).or_insert_with(|| {
                                            (
                                                tc.id.clone().unwrap_or_else(|| {
                                                    format!("call_{}_{}", tc.index, uuid::Uuid::new_v4().simple())
                                                }),
                                                String::new(),
                                                String::new(),
                                            )
                                        });

                                        if let Some(new_id) = tc.id {
                                            if !new_id.is_empty() {
                                                entry.0 = new_id;
                                            }
                                        }

                                        if let Some(fn_call) = tc.function {
                                            if let Some(name) = fn_call.name {
                                                if !name.is_empty() {
                                                    entry.1.push_str(&name);
                                                    handler.on_tool_call_start(tc.index, &entry.0, &entry.1);
                                                }
                                            }
                                            if let Some(args_chunk) = fn_call.arguments {
                                                if !args_chunk.is_empty() {
                                                    entry.2.push_str(&args_chunk);
                                                    handler.on_tool_call_delta(tc.index, &entry.0, &args_chunk);
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
        }

        if in_reasoning {
            handler.on_reasoning_end();
        }
        if in_text {
            handler.on_text_end();
        }

        // Notify tool call ends
        let mut tool_calls = Vec::new();
        let mut sorted_indices: Vec<usize> = tool_calls_map.keys().cloned().collect();
        sorted_indices.sort_unstable();

        for idx in sorted_indices {
            if let Some((id, name, args)) = tool_calls_map.remove(&idx) {
                handler.on_tool_call_end(idx, &id);
                tool_calls.push(ToolCall {
                    id,
                    r#type: "function".into(),
                    function: FunctionCall {
                        name,
                        arguments: args,
                    },
                });
            }
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
