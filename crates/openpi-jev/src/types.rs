use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum JevQuestion {
    #[serde(rename = "noul")]
    Noul { id: String, instructions: String },

    #[serde(rename = "choice")]
    Choice { id: String, instructions: String, options: Vec<String> },

    #[serde(rename = "score")]
    Score { id: String, instructions: String, levels: Vec<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JevRequest {
    pub state: String,
    pub questions: Vec<JevQuestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JevAnswer {
    pub id: String,
    pub value: serde_json::Value,
    pub confidence: f32,
    pub distribution: Option<Vec<(String, f32)>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JevResponse {
    pub answers: Vec<JevAnswer>,
}

// ============================================================================
// Pillar 1: Mode & Model Routing
// ============================================================================
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AppMode {
    Chat,
    Code,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelTier {
    Fast,      // e.g. gemini-2.5-flash / haiku
    Thinking,  // e.g. claude-3.7-sonnet with thinking / gemini-2.5-pro
    Max,       // large multi-file refactoring
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteDecision {
    pub mode: AppMode,
    pub recommended_tier: ModelTier,
    pub confidence: f32,
    pub requires_workspace: bool,
    pub reason: String,
}

// ============================================================================
// Pillar 2: Pre-Execution Gatekeeper
// ============================================================================
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum GateVerdict {
    Allow,
    Warn {
        reasons: Vec<String>,
    },
    RequireConfirmation {
        prompt: String,
        reasons: Vec<String>,
        risk_score: f32,
    },
    Deny {
        reason: String,
    },
    ModifyCommand {
        safe_command: String,
        reason: String,
    },
}

// ============================================================================
// Pillar 3: Log Stream & Token Compressor
// ============================================================================
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressedOutput {
    pub content: String,
    pub original_chars: usize,
    pub compressed_chars: usize,
    pub lines_truncated: usize,
    pub estimated_tokens_saved: usize,
    pub was_compressed: bool,
}

// ============================================================================
// Pillar 4: Loop Breaker & Self-Heal
// ============================================================================
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopAnalysis {
    pub is_looping: bool,
    pub loop_count: usize,
    pub should_break: bool,
    pub corrective_hint: Option<String>,
}

// ============================================================================
// Pillar 5: Leak Hunter
// ============================================================================
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeakScanResult {
    pub has_leaks: bool,
    pub leak_count: usize,
    pub sanitized_text: String,
    pub redacted_types: Vec<String>,
}

// ============================================================================
// Pillar 6: Stop Decider
// ============================================================================
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StopVerdict {
    pub should_stop: bool,
    pub confidence: f32,
    pub rationale: String,
}
