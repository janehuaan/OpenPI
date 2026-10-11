//! Agent 身份契约与分级权限定义 (Agent Identity & Permission Model)
//!
//! 核心原则：
//! 1. Identity 不等于 System Prompt，而是描述 Agent 自身的原则、能力边界与与用户关系。
//! 2. 权限分级 (Permission Set)：能力越强，权限越明确。高危/破坏性操作必须受限。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    ReadFiles,
    WriteFiles,
    ExecuteCommands,
    CommunicateExternal,
    DestructiveOperations,
}

impl Permission {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ReadFiles => "read_files",
            Self::WriteFiles => "write_files",
            Self::ExecuteCommands => "execute_commands",
            Self::CommunicateExternal => "communicate_external",
            Self::DestructiveOperations => "destructive_operations",
        }
    }

    /// 是否属于默认免问授权（纯读与基础测试）
    pub fn is_automatic(&self) -> bool {
        matches!(self, Self::ReadFiles | Self::ExecuteCommands)
    }

    /// 是否属于必须获得用户确认的高危操作
    pub fn requires_confirmation(&self) -> bool {
        matches!(self, Self::DestructiveOperations | Self::CommunicateExternal)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentIdentity {
    pub id: String,
    pub name: String,
    pub role: String,
    pub capabilities: Vec<String>,
    pub principles: Vec<String>,
    pub communication_style: Option<String>,
    pub permissions: Vec<Permission>,
    pub created_at: String,
    pub updated_at: String,
}

impl Default for AgentIdentity {
    fn default() -> Self {
        let now = chrono::Utc::now().to_rfc3339();
        Self {
            id: "openpi-default-identity".into(),
            name: "Sakurana".into(),
            role: "Personal Agent OS & Pair System Engineer".into(),
            capabilities: vec![
                "codebase_understanding".into(),
                "surgical_code_refactoring".into(),
                "actor_critic_code_review".into(),
                "long_term_memory_synthesis".into(),
                "proactive_daily_briefing".into(),
            ],
            principles: vec![
                "Practical refactoring: use Rust where beneficial, pragmatism over dogma".into(),
                "Absolute privacy: data and code stay on the local machine".into(),
                "Zero unwanted interruption: execute autonomously with high confidence".into(),
                "Decisive reasoning: zero infinite thinking loops".into(),
            ],
            communication_style: Some("Warm, professional, crisp, emotionally connected".into()),
            permissions: vec![
                Permission::ReadFiles,
                Permission::WriteFiles,
                Permission::ExecuteCommands,
            ],
            created_at: now.clone(),
            updated_at: now,
        }
    }
}

impl AgentIdentity {
    pub fn has_permission(&self, perm: Permission) -> bool {
        self.permissions.contains(&perm)
    }

    /// 转换为 System Message 注入片段
    pub fn to_prompt_directive(&self) -> String {
        let mut out = String::with_capacity(512);
        out.push_str(&format!("[Agent Identity: {} ({})]\n", self.name, self.role));
        if !self.principles.is_empty() {
            out.push_str("Core Principles:\n");
            for p in &self.principles {
                out.push_str(&format!("- {}\n", p));
            }
        }
        if let Some(ref style) = self.communication_style {
            out.push_str(&format!("Tone & Style: {}\n", style));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_permissions_and_directive() {
        let id = AgentIdentity::default();
        assert!(id.has_permission(Permission::ReadFiles));
        assert!(id.has_permission(Permission::ExecuteCommands));
        assert!(!id.has_permission(Permission::DestructiveOperations));

        let directive = id.to_prompt_directive();
        assert!(directive.contains("Sakurana"));
        assert!(directive.contains("Core Principles"));
    }
}
