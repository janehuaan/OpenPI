//! 个人记忆生命周期管理与分类体系 (Personal Memory Lifecycle & Classification)
//!
//! 核心原则：
//! 1. Memory ≠ Vector DB（Vector 只是多维检索手段之一）
//! 2. 区分不同类型记忆的生命周期与半衰期：
//!    - Profile (用户画像): 极低衰减，基础权重最高
//!    - Decision (技术决策): 记录“为什么选A放弃B”，极高抗衰减因子
//!    - Preference (习惯偏好): 行为准则，高权重
//!    - Feedback (用户纠偏): 长期有效性检验
//!    - Temporary (短期临时上下文): 自然衰减淘汰

use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryCategory {
    Profile,
    Preference,
    Project,
    Decision,
    Experience,
    Feedback,
    Temporary,
}

impl MemoryCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Profile => "profile",
            Self::Preference => "preference",
            Self::Project => "project",
            Self::Decision => "decision",
            Self::Experience => "experience",
            Self::Feedback => "feedback",
            Self::Temporary => "temporary",
        }
    }

    /// 基础推荐权重 (0.0 ~ 1.0)
    pub fn default_importance(&self) -> f32 {
        match self {
            Self::Profile => 0.95,
            Self::Decision => 0.90,
            Self::Preference => 0.85,
            Self::Feedback => 0.85,
            Self::Project => 0.70,
            Self::Experience => 0.60,
            Self::Temporary => 0.40,
        }
    }

    /// 记忆半衰期（秒），决定该类记忆自然衰减的速度
    pub fn default_half_life_secs(&self) -> f32 {
        match self {
            Self::Profile => 60.0 * 86400.0,    // 60 天
            Self::Decision => 45.0 * 86400.0,   // 45 天 (核心决策长久保鲜)
            Self::Preference => 30.0 * 86400.0, // 30 天
            Self::Feedback => 21.0 * 86400.0,   // 21 天
            Self::Project => 14.0 * 86400.0,    // 14 天
            Self::Experience => 7.0 * 86400.0,  // 7 天
            Self::Temporary => 1.0 * 86400.0,   // 1 天
        }
    }
}

impl fmt::Display for MemoryCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for MemoryCategory {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "profile" => Ok(Self::Profile),
            "preference" => Ok(Self::Preference),
            "project" => Ok(Self::Project),
            "decision" => Ok(Self::Decision),
            "experience" => Ok(Self::Experience),
            "feedback" => Ok(Self::Feedback),
            "temporary" => Ok(Self::Temporary),
            _ => Err(()),
        }
    }
}

/// 记忆综合有效分计算器 (结合基础重要性、访问增强、时间衰减与查询相关度)
pub fn compute_memory_effective_score(
    importance: f32,
    confidence: f32,
    access_count: i64,
    created_at_epoch: u64,
    last_accessed_epoch: Option<u64>,
    half_life_secs: f32,
    now_epoch: u64,
) -> f32 {
    let last_ref = last_accessed_epoch.unwrap_or(created_at_epoch);
    let delta_t = (now_epoch.saturating_sub(last_ref)) as f32;

    // 访问频次增强因子：重复访问强化记忆保鲜度，上限 3.0x
    let strength = (1.0 + (access_count.max(0) as f32) * 0.2).min(3.0);
    let tau = half_life_secs * strength;

    let decay = (-delta_t / tau.max(1.0)).exp();
    let score = importance * confidence * decay;
    score.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_categories() {
        assert_eq!(MemoryCategory::Decision.as_str(), "decision");
        assert_eq!("preference".parse::<MemoryCategory>(), Ok(MemoryCategory::Preference));
        assert!(MemoryCategory::Decision.default_importance() >= 0.9);
    }

    #[test]
    fn test_effective_score_decay() {
        let now = 1000000;
        let score_fresh = compute_memory_effective_score(0.9, 1.0, 0, now, None, 86400.0, now);
        assert!((score_fresh - 0.9).abs() < 1e-4);

        // 经过 1 个半衰期，分数衰减为 ~ 0.9 * 0.3678 = ~0.33
        let score_decayed = compute_memory_effective_score(0.9, 1.0, 0, now - 86400, None, 86400.0, now);
        assert!(score_decayed < score_fresh);
        assert!(score_decayed > 0.2);

        // 高频访问强化衰减抵抗
        let score_reinforced = compute_memory_effective_score(0.9, 1.0, 10, now - 86400, None, 86400.0, now);
        assert!(score_reinforced > score_decayed);
    }
}
