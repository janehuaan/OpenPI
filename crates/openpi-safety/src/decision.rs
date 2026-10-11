//! 离散可测决策矩阵与确定性规则 (Deterministic Decision Engine)
//!
//! 核心原则：
//! 1. 彻底弃用连续浮点数乘积，采用 0~3 标度离散等级与有限确定性规则集。
//! 2. 8 种有限输出动作：IGNORE, REMEMBER, SUGGEST, ASK, PREPARE, EXECUTE, RESUME, MONITOR。
//! 3. 5 条确定性规则保障系统决策完全可重现、单测可百分百覆盖。

use serde::{Deserialize, Serialize};

/// 0~3 离散评估标度
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct DiscreteScore(pub u8);

impl DiscreteScore {
    pub fn new(val: u8) -> Self {
        Self(val.min(3))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionMetrics {
    /// 重要性 (0: 微不足道, 1: 次要关注, 2: 核心功能, 3: 阻断/关键)
    pub importance: u8,
    /// 目标关联度 (0: 无关, 1: 间接关联, 2: 直接关联, 3: 处于激活路径)
    pub relevance: u8,
    /// 置信度 (0: <50%, 1: 50-75%, 2: 75-90%, 3: >=90%)
    pub confidence: u8,
    /// 期望收益 (0: 可忽略, 1: 略微节省, 2: 显著提升, 3: 关键阻塞)
    pub expected_value: u8,
    /// 风险等级 (0: 只读零风险, 1: 可撤销, 2: 文件修改, 3: 不可逆/外网)
    pub risk: u8,
    /// 打扰成本 (0: 极低空闲, 1: 低常规编码, 2: 中专注, 3: 极高会议)
    pub interruption_cost: u8,
    /// 行动开销 (0: 极低免LLM, 1: 少量Token, 2: 中等编排, 3: 重度耗时)
    pub action_cost: u8,
}

impl Default for DecisionMetrics {
    fn default() -> Self {
        Self {
            importance: 1,
            relevance: 1,
            confidence: 2,
            expected_value: 1,
            risk: 0,
            interruption_cost: 1,
            action_cost: 1,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DiscreteDecisionAction {
    /// 忽略，不行动
    Ignore,
    /// 仅记入记忆库，不打扰
    Remember,
    /// 主动向用户提出温和建议
    Suggest,
    /// 缺乏信息或高风险，发起确认询问
    Ask,
    /// 后台静默准备/生成 Worktree，不打扰用户
    Prepare,
    /// 自主通过 Gateway 发起执行
    Execute,
    /// 恢复暂停中的任务
    Resume,
    /// 持续守候关注
    Monitor,
}

pub struct DeterministicDecisionEngine;

impl DeterministicDecisionEngine {
    /// 核心评估函数（严格执行 Spec Section 12.3 的有限确定性规则）
    pub fn evaluate(metrics: &DecisionMetrics) -> DiscreteDecisionAction {
        // 规则 1：高风险操作必须人工确认 (risk >= 2)
        if metrics.risk >= 2 {
            return if metrics.importance >= 2 {
                DiscreteDecisionAction::Ask
            } else {
                DiscreteDecisionAction::Ignore
            };
        }

        // 规则 2：低置信度严禁直接自主执行 (confidence < 2)
        if metrics.confidence < 2 {
            if metrics.importance >= 2 && metrics.interruption_cost <= 1 {
                return DiscreteDecisionAction::Ask;
            }
            return DiscreteDecisionAction::Ignore;
        }

        // 规则 3：高重要 + 高关联 + 高置信 + 低风险 -> EXECUTE
        if metrics.importance >= 2
            && metrics.relevance >= 2
            && metrics.confidence == 3
            && metrics.risk <= 1
        {
            return DiscreteDecisionAction::Execute;
        }

        // 规则 4：值得做但打扰成本高 -> 后台静默准备 (PREPARE)
        if metrics.expected_value >= 2 && metrics.interruption_cost >= 2 {
            return DiscreteDecisionAction::Prepare;
        }

        // 规则 5：仅具沉淀价值 -> REMEMBER
        if metrics.importance >= 1 && metrics.action_cost == 0 {
            return DiscreteDecisionAction::Remember;
        }

        // 次级温和建议：重要且打扰成本低
        if metrics.importance >= 2 && metrics.interruption_cost <= 1 {
            return DiscreteDecisionAction::Suggest;
        }

        DiscreteDecisionAction::Ignore
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_high_importance_high_relevance_high_confidence_low_risk_executes() {
        let m = DecisionMetrics {
            importance: 3,
            relevance: 3,
            confidence: 3,
            expected_value: 3,
            risk: 1,
            interruption_cost: 0,
            action_cost: 1,
        };
        assert_eq!(DeterministicDecisionEngine::evaluate(&m), DiscreteDecisionAction::Execute);
    }

    #[test]
    fn test_high_risk_requires_ask_or_ignore() {
        // 重要但高风险 -> ASK
        let m1 = DecisionMetrics {
            importance: 2,
            relevance: 2,
            confidence: 3,
            expected_value: 2,
            risk: 2,
            interruption_cost: 0,
            action_cost: 1,
        };
        assert_eq!(DeterministicDecisionEngine::evaluate(&m1), DiscreteDecisionAction::Ask);

        // 不重要且高风险 -> IGNORE
        let m2 = DecisionMetrics {
            importance: 1,
            relevance: 1,
            confidence: 3,
            expected_value: 1,
            risk: 2,
            interruption_cost: 0,
            action_cost: 1,
        };
        assert_eq!(DeterministicDecisionEngine::evaluate(&m2), DiscreteDecisionAction::Ignore);
    }

    #[test]
    fn test_high_expected_value_high_interruption_cost_prepares() {
        let m = DecisionMetrics {
            importance: 1,
            relevance: 1,
            confidence: 2,
            expected_value: 2,
            risk: 0,
            interruption_cost: 2,
            action_cost: 1,
        };
        assert_eq!(DeterministicDecisionEngine::evaluate(&m), DiscreteDecisionAction::Prepare);
    }

    #[test]
    fn test_zero_action_cost_remembers() {
        let m = DecisionMetrics {
            importance: 1,
            relevance: 0,
            confidence: 2,
            expected_value: 0,
            risk: 0,
            interruption_cost: 0,
            action_cost: 0,
        };
        assert_eq!(DeterministicDecisionEngine::evaluate(&m), DiscreteDecisionAction::Remember);
    }
}
