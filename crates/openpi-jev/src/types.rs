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

// ============================================================================
// Telemetry & Audit Records
// ============================================================================
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockRecord {
    pub timestamp: u64,
    pub command: String,
    pub action: String,
    pub reason: String,
    pub risk: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DreamRecord {
    pub timestamp: u64,
    #[serde(alias = "sessions_evaluated")]
    pub sessions_evaluated: usize,
    #[serde(alias = "total_nodes")]
    pub total_nodes: usize,
    #[serde(alias = "optimal_beta")]
    pub optimal_beta: f64,
    #[serde(alias = "pareto_reward")]
    pub pareto_reward: f64,
    #[serde(alias = "decision_rounds")]
    pub decision_rounds: usize,
    #[serde(alias = "parallelism_efficiency")]
    pub parallelism_efficiency: f64,
    #[serde(default, alias = "discovery_quality")]
    pub discovery_quality: f64,
    #[serde(default, alias = "total_churn")]
    pub total_churn: usize,
    #[serde(default, alias = "counterfactual_speedup")]
    pub counterfactual_speedup: f64,
    #[serde(default, alias = "contextual_betas")]
    pub contextual_betas: std::collections::HashMap<String, f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JevTelemetry {
    #[serde(alias = "blocked_commands")]
    pub blocked_commands: usize,
    #[serde(alias = "user_confirmed_commands")]
    pub user_confirmed_commands: usize,
    #[serde(alias = "auto_patched_commands")]
    pub auto_patched_commands: usize,
    #[serde(alias = "secrets_redacted")]
    pub secrets_redacted: usize,
    #[serde(alias = "estimated_tokens_saved")]
    pub estimated_tokens_saved: usize,
    #[serde(alias = "loop_breaks")]
    pub loop_breaks: usize,
    #[serde(default, alias = "recent_blocks")]
    pub recent_blocks: Vec<BlockRecord>,
    #[serde(default, alias = "recent_dreams")]
    pub recent_dreams: Vec<DreamRecord>,
}

