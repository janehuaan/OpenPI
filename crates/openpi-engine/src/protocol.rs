use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChatContent {
    Text(String),
    Parts(Vec<ChatContentPart>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ChatContentPart {
    #[serde(rename = "text")]
    Text {
        text: String,
        /// Anthropic-style prompt-cache breakpoint. Only serialized when set, so
        /// ordinary requests stay byte-identical to before.
        #[serde(skip_serializing_if = "Option::is_none")]
        cache_control: Option<CacheControl>,
    },
    #[serde(rename = "image_url")]
    ImageUrl { image_url: ImageUrlContent },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CacheControl {
    pub r#type: String,
}

impl CacheControl {
    pub fn ephemeral() -> Self {
        Self { r#type: "ephemeral".into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageUrlContent {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub r#type: String, // "function"
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<ChatContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Reasoning models (DeepSeek-R1 family and compatible gateways) require the
    /// assistant turn's `reasoning_content` to be echoed back on subsequent requests,
    /// otherwise multi-turn tool calling is rejected or degraded.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    /// Optional offloaded artifact reference for large tool payloads (ActKV bypass).
    ///
    /// Never serialized: it is internal bookkeeping, and the preview it carries
    /// is already inlined into `content`. Sending it would both duplicate ~16KB
    /// per offloaded result and put a non-standard field on the wire to the
    /// provider — the offload measured 32,980 chars instead of the intended
    /// 16,466 for a 311,804-char payload.
    #[serde(skip)]
    pub artifact: Option<ArtifactRef>,
}

/// Reference metadata for offloaded large payloads
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtifactRef {
    pub id: String,
    pub original_len: usize,
    pub preview: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_key: Option<String>,
}

impl ChatMessage {
    pub fn system(text: impl Into<String>) -> Self {
        Self {
            role: "system".into(),
            content: Some(ChatContent::Text(text.into())),
            name: None,
            tool_calls: None,
            tool_call_id: None,
            reasoning_content: None,
            artifact: None,
        }
    }

    pub fn user(text: impl Into<String>) -> Self {
        Self {
            role: "user".into(),
            content: Some(ChatContent::Text(text.into())),
            name: None,
            tool_calls: None,
            tool_call_id: None,
            reasoning_content: None,
            artifact: None,
        }
    }

    pub fn assistant(text: impl Into<String>) -> Self {
        Self {
            role: "assistant".into(),
            content: Some(ChatContent::Text(text.into())),
            name: None,
            tool_calls: None,
            tool_call_id: None,
            reasoning_content: None,
            artifact: None,
        }
    }

    /// Marks this message as an Anthropic prompt-cache breakpoint by putting
    /// `cache_control: {"type":"ephemeral"}` on its last text part. String
    /// content is widened into a single text part. Returns false when the
    /// message has no text part to attach to (nothing was modified).
    pub fn mark_cache_breakpoint(&mut self) -> bool {
        match self.content.take() {
            Some(ChatContent::Text(text)) => {
                self.content = Some(ChatContent::Parts(vec![ChatContentPart::Text {
                    text,
                    cache_control: Some(CacheControl::ephemeral()),
                }]));
                true
            }
            Some(ChatContent::Parts(mut parts)) => {
                let slot = parts.iter_mut().rev().find_map(|part| match part {
                    ChatContentPart::Text { cache_control, .. } => Some(cache_control),
                    _ => None,
                });
                match slot {
                    Some(slot) => {
                        *slot = Some(CacheControl::ephemeral());
                        self.content = Some(ChatContent::Parts(parts));
                        true
                    }
                    None => {
                        self.content = Some(ChatContent::Parts(parts));
                        false
                    }
                }
            }
            None => false,
        }
    }

    pub fn tool_result(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: "tool".into(),
            content: Some(ChatContent::Text(content.into())),
            name: None,
            tool_calls: None,
            tool_call_id: Some(tool_call_id.into()),
            reasoning_content: None,
            artifact: None,
        }
    }

    /// Creates a tool result, automatically offloading large payloads to an ArtifactRef
    /// if the content exceeds `max_inline_len` bytes. The inline message only retains a
    /// compact preview + reference metadata, preventing LLM context bloat.
    pub fn tool_result_with_bypass(
        tool_call_id: impl Into<String>,
        content: impl Into<String>,
        max_inline_len: usize,
    ) -> (Self, Option<String>) {
        let text = content.into();
        let call_id = tool_call_id.into();
        if text.len() <= max_inline_len {
            (Self::tool_result(call_id, text), None)
        } else {
            let original_len = text.len();
            // Take first max_inline_len characters as preview
            let preview_boundary = text
                .char_indices()
                .map(|(idx, _)| idx)
                .take_while(|&idx| idx <= max_inline_len)
                .last()
                .unwrap_or(0);
            let preview = text[..preview_boundary].to_string();
            let artifact_id = format!("art_{}_{}", &call_id[..call_id.len().min(8)], original_len);
            let inline_summary = format!(
                "[Payload offloaded: {} bytes. Preview: {}... (artifact_id: {})]",
                original_len, preview, artifact_id
            );
            let artifact = ArtifactRef {
                id: artifact_id,
                original_len,
                preview,
                storage_key: None,
            };
            let msg = Self {
                role: "tool".into(),
                content: Some(ChatContent::Text(inline_summary)),
                name: None,
                tool_calls: None,
                tool_call_id: Some(call_id),
                reasoning_content: None,
                artifact: Some(artifact),
            };
            (msg, Some(text))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub r#type: String, // "function"
    pub function: ToolFunctionDef,
}

impl ToolDefinition {
    pub fn new(name: impl Into<String>, description: impl Into<String>, parameters: Value) -> Self {
        Self {
            r#type: "function".into(),
            function: ToolFunctionDef {
                name: name.into(),
                description: description.into(),
                parameters,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamOptions {
    pub include_usage: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<ToolDefinition>>,
    pub stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_options: Option<StreamOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TokenUsage {
    #[serde(default)]
    pub prompt_tokens: usize,
    #[serde(default)]
    pub completion_tokens: usize,
    #[serde(default)]
    pub total_tokens: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<usize>,
    /// OpenAI-style cache accounting: `prompt_tokens_details.cached_tokens`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_tokens_details: Option<PromptTokensDetails>,
    /// DeepSeek-style: `prompt_cache_hit_tokens`.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub prompt_cache_hit_tokens: usize,
    /// DeepSeek-style: `prompt_cache_miss_tokens`.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub prompt_cache_miss_tokens: usize,
    /// Anthropic-through-a-compat-proxy: `cache_read_input_tokens`.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub cache_read_input_tokens: usize,
    /// Anthropic-through-a-compat-proxy: `cache_creation_input_tokens`.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub cache_creation_input_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PromptTokensDetails {
    #[serde(default)]
    pub cached_tokens: usize,
    /// Some Anthropic-compatible relays nest cache-write accounting here
    /// (e.g. huaan.space reports `cached_creation_tokens`).
    #[serde(default)]
    pub cached_creation_tokens: usize,
    #[serde(default)]
    pub cache_write_tokens: usize,
}

fn is_zero(value: &usize) -> bool {
    *value == 0
}

impl TokenUsage {
    /// Prompt tokens served from the provider's cache, normalized across the
    /// shapes we see in the wild: OpenAI `prompt_tokens_details.cached_tokens`,
    /// DeepSeek `prompt_cache_hit_tokens`, Anthropic `cache_read_input_tokens`.
    pub fn cache_read_tokens(&self) -> usize {
        let openai = self.prompt_tokens_details.as_ref().map(|d| d.cached_tokens).unwrap_or(0);
        self.cache_read_input_tokens
            .max(self.prompt_cache_hit_tokens)
            .max(openai)
    }

    /// Prompt tokens written to the provider's cache, normalized across
    /// Anthropic's top-level field and the nested variants some relays emit.
    pub fn cache_creation_tokens(&self) -> usize {
        let nested = self
            .prompt_tokens_details
            .as_ref()
            .map(|d| d.cached_creation_tokens.max(d.cache_write_tokens))
            .unwrap_or(0);
        self.cache_creation_input_tokens.max(nested)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChunkFunctionCall {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChunkToolCall {
    #[serde(default)]
    pub index: usize,
    pub id: Option<String>,
    pub r#type: Option<String>,
    pub function: Option<ChunkFunctionCall>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChunkDelta {
    pub role: Option<String>,
    pub content: Option<String>,
    pub reasoning_content: Option<String>,
    pub reasoning: Option<String>,
    pub thought: Option<String>,
    pub tool_calls: Option<Vec<ChunkToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChunkChoice {
    #[serde(default)]
    pub index: usize,
    #[serde(default)]
    pub delta: ChunkDelta,
    pub finish_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionChunk {
    pub id: Option<String>,
    #[serde(default)]
    pub choices: Vec<ChunkChoice>,
    pub usage: Option<TokenUsage>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_usage_reads_provider_cache_fields() {
        let openai: TokenUsage = serde_json::from_value(serde_json::json!({
            "prompt_tokens": 1000, "completion_tokens": 50,
            "prompt_tokens_details": { "cached_tokens": 768 }
        }))
        .unwrap();
        assert_eq!(openai.cache_read_tokens(), 768);

        let deepseek: TokenUsage = serde_json::from_value(serde_json::json!({
            "prompt_tokens": 1000, "completion_tokens": 50,
            "prompt_cache_hit_tokens": 640, "prompt_cache_miss_tokens": 360
        }))
        .unwrap();
        assert_eq!(deepseek.cache_read_tokens(), 640);

        let anthropic: TokenUsage = serde_json::from_value(serde_json::json!({
            "prompt_tokens": 5, "completion_tokens": 5,
            "cache_read_input_tokens": 900, "cache_creation_input_tokens": 128
        }))
        .unwrap();
        assert_eq!(anthropic.cache_read_tokens(), 900);
        assert_eq!(anthropic.cache_creation_tokens(), 128);

        // A provider that reports no cache fields stays at zero (no false hits).
        let plain: TokenUsage =
            serde_json::from_value(serde_json::json!({ "prompt_tokens": 10, "completion_tokens": 2 })).unwrap();
        assert_eq!(plain.cache_read_tokens(), 0);
        assert_eq!(plain.cache_creation_tokens(), 0);
    }

    #[test]
    fn token_usage_reads_nested_cache_write_fields() {
        // huaan.space-style relay: cache accounting nested under
        // prompt_tokens_details, with a non-standard write field name.
        let relay: TokenUsage = serde_json::from_value(serde_json::json!({
            "prompt_tokens": 9000, "completion_tokens": 20,
            "prompt_tokens_details": {
                "cached_tokens": 4077,
                "cached_creation_tokens": 512,
                "cache_write_tokens": 0
            }
        }))
        .unwrap();
        assert_eq!(relay.cache_read_tokens(), 4077);
        assert_eq!(relay.cache_creation_tokens(), 512);

        let alt: TokenUsage = serde_json::from_value(serde_json::json!({
            "prompt_tokens": 10, "completion_tokens": 2,
            "prompt_tokens_details": { "cache_write_tokens": 640 }
        }))
        .unwrap();
        assert_eq!(alt.cache_creation_tokens(), 640);
    }

    #[test]
    fn cache_breakpoint_widens_string_content() {
        let mut msg = ChatMessage::system("hello");
        assert!(msg.mark_cache_breakpoint());
        let v = serde_json::to_value(&msg).unwrap();
        assert_eq!(
            v["content"],
            serde_json::json!([{ "type": "text", "text": "hello", "cache_control": { "type": "ephemeral" } }])
        );
        // Idempotent: re-marking must not duplicate parts.
        assert!(msg.mark_cache_breakpoint());
        let v2 = serde_json::to_value(&msg).unwrap();
        assert_eq!(v, v2);
    }

    #[test]
    fn cache_breakpoint_leaves_plain_messages_untouched() {
        // Nothing is serialized when no breakpoint is set, so non-caching
        // providers keep receiving the exact same payload as before.
        let msg = ChatMessage::user("hi");
        let v = serde_json::to_value(&msg).unwrap();
        assert_eq!(v["content"], serde_json::json!("hi"));

        let mut empty = ChatMessage { content: None, ..ChatMessage::user("x") };
        assert!(!empty.mark_cache_breakpoint());
        assert!(empty.content.is_none());
    }

    #[test]
    fn test_tool_result_small_payload_no_bypass() {
        let small_content = "hello world";
        let (msg, offloaded) = ChatMessage::tool_result_with_bypass("call_1", small_content, 100);
        assert!(offloaded.is_none());
        assert!(msg.artifact.is_none());
        match msg.content {
            Some(ChatContent::Text(t)) => assert_eq!(t, "hello world"),
            _ => panic!("expected text"),
        }
    }

    #[test]
    fn test_tool_result_large_payload_bypassed_with_artifact() {
        let large_content = "A".repeat(500);
        let (msg, offloaded) = ChatMessage::tool_result_with_bypass("call_large_123", &large_content, 50);
        assert_eq!(offloaded, Some(large_content));
        let art = msg.artifact.expect("artifact ref should be present");
        assert_eq!(art.original_len, 500);
        assert_eq!(art.preview.len(), 50);
        match msg.content {
            Some(ChatContent::Text(t)) => {
                assert!(t.contains("[Payload offloaded: 500 bytes."));
                assert!(t.contains(&art.id));
            }
            _ => panic!("expected text summary"),
        }
    }

    #[test]
    fn test_bypassed_tool_result_is_bounded_on_the_wire() {
        // Real incident: one `skill_scan` call returned 311,804 chars. It went
        // into the context verbatim and produced a 135k-token request, which is
        // what made long sessions crawl. Pin the real size.
        const REAL_INCIDENT_LEN: usize = 311_804;
        const CAP: usize = 16 * 1024;

        let (msg, offloaded) =
            ChatMessage::tool_result_with_bypass("call_scan", "x".repeat(REAL_INCIDENT_LEN), CAP);
        assert!(offloaded.is_some(), "the full payload must be offloaded");

        let wire = serde_json::to_string(&msg).expect("message must serialize");
        println!(
            "REAL_INCIDENT: {} chars in -> {} chars on the wire (inline content {} chars)",
            REAL_INCIDENT_LEN,
            wire.len(),
            match &msg.content {
                Some(ChatContent::Text(t)) => t.len(),
                _ => 0,
            }
        );
        // The wire payload is the inline preview plus a short marker. It must
        // stay at the cap — not at twice the cap, which is what happens if the
        // `artifact` preview is serialized alongside the inlined one.
        assert!(
            wire.len() <= CAP + 512,
            "offloaded tool message must stay at the {CAP}-char cap, got {} chars on the wire",
            wire.len()
        );
    }
}
