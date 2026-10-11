//! 十大系统不变量看门狗 (Ten System Invariants Guard)
//!
//! 核心原则：
//! 1. 系统在任何情况下必须强保证的 10 条底线不变量。
//! 2. 违反任何不变量时立即阻断并抛出结构化的 InvariantViolation。

use crate::attribution::{EvidenceRef, UserPreferenceRecord};
use crate::budget::{BudgetCategory, ResourceBudgetManager};
use crate::circuit_breaker::{CircuitBreaker, CircuitState};
use crate::decision::DiscreteDecisionAction;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InvariantViolation {
    #[error("Invariant 1 违规: 执行缺少 <= 500ms 可终止路径 (details: {0})")]
    Invariant1NoCancellablePath(String),

    #[error("Invariant 2 违规: 自动行动越界未授权 (action: {action}, reason: {reason})")]
    Invariant2PermissionBoundary { action: String, reason: String },

    #[error("Invariant 3 违规: 长期学习条目缺少溯源链 (id: {0})")]
    Invariant3MissingEvidenceChain(String),

    #[error("Invariant 4 违规: 用户模型更新不满足可回滚条件 (id: {0})")]
    Invariant4NotRollbackCapable(String),

    #[error("Invariant 5 违规: 后台活动超出或未申请资源预算 (category: {category:?})")]
    Invariant5BudgetViolation { category: BudgetCategory },

    #[error("Invariant 6 违规: 事件洪峰突破去抖门限 (interval: {interval_ms}ms < min {min_ms}ms)")]
    Invariant6DebounceViolation { interval_ms: i64, min_ms: i64 },

    #[error("Invariant 7 违规: 绕过了 Execution Gateway 直接调用执行底座")]
    Invariant7BypassedGateway,

    #[error("Invariant 8 违规: 执行层失败侵入污染了个人状态")]
    Invariant8StatePollution,

    #[error("Invariant 9 违规: 衍生事件递归深度超限 (depth: {depth} > max {max_depth})")]
    Invariant9RecursionDepthExceeded { depth: u32, max_depth: u32 },

    #[error("Invariant 10 违规: 熔断降级态下违规尝试执行非观察动作 ({action:?})")]
    Invariant10DegradeViolation { action: DiscreteDecisionAction },
}

pub struct InvariantGuard;

impl InvariantGuard {
    /// Invariant 1: 验证任务是否持有可终止路径
    pub fn assert_cancellable(has_cancellation_token: bool, timeout_ms: u64) -> Result<(), InvariantViolation> {
        if !has_cancellation_token || timeout_ms == 0 {
            return Err(InvariantViolation::Invariant1NoCancellablePath(
                "Missing cancellation token or non-zero timeout".into(),
            ));
        }
        Ok(())
    }

    /// Invariant 2: 验证自动行动是否有权限边界
    pub fn assert_permission_boundary(
        action: &str,
        is_read_only: bool,
        has_user_confirmation: bool,
    ) -> Result<(), InvariantViolation> {
        if is_read_only {
            return Ok(());
        }
        // 写操作、删除操作、外网必须具备人工明确确认
        if !has_user_confirmation {
            return Err(InvariantViolation::Invariant2PermissionBoundary {
                action: action.to_string(),
                reason: "Non-readonly action requires explicit user confirmation".into(),
            });
        }
        Ok(())
    }

    /// Invariant 3: 验证长期学习条目附带有效溯源链
    pub fn assert_evidence_chain(id: &str, evidence: &[EvidenceRef]) -> Result<(), InvariantViolation> {
        if evidence.is_empty() {
            return Err(InvariantViolation::Invariant3MissingEvidenceChain(id.to_string()));
        }
        Ok(())
    }

    /// Invariant 4: 验证 User Model 更新具备版本和回滚能力
    pub fn assert_rollback_capable(record: &UserPreferenceRecord) -> Result<(), InvariantViolation> {
        if record.version == 0 || record.id.is_empty() {
            return Err(InvariantViolation::Invariant4NotRollbackCapable(record.id.clone()));
        }
        Ok(())
    }

    /// Invariant 5: 验证后台活动受资源预算约束
    pub fn assert_budget_envelope(
        budget_mgr: &ResourceBudgetManager,
        category: BudgetCategory,
        required_amount: u64,
    ) -> Result<(), InvariantViolation> {
        if budget_mgr.is_budget_critical() {
            return Err(InvariantViolation::Invariant5BudgetViolation { category });
        }
        // 尝试预扣测试
        match budget_mgr.reserve(category, required_amount) {
            Ok(token) => {
                let _ = budget_mgr.release(&token);
                Ok(())
            }
            Err(_) => Err(InvariantViolation::Invariant5BudgetViolation { category }),
        }
    }

    /// Invariant 6: 验证事件去抖防洪峰
    pub fn assert_debounce(
        last_event_time: i64,
        now_time: i64,
        min_interval_ms: i64,
    ) -> Result<(), InvariantViolation> {
        let diff = now_time - last_event_time;
        if diff < min_interval_ms {
            return Err(InvariantViolation::Invariant6DebounceViolation {
                interval_ms: diff,
                min_ms: min_interval_ms,
            });
        }
        Ok(())
    }

    /// Invariant 7: 验证执行请求必须穿透 Gateway
    pub fn assert_gateway_execution(via_gateway: bool) -> Result<(), InvariantViolation> {
        if !via_gateway {
            return Err(InvariantViolation::Invariant7BypassedGateway);
        }
        Ok(())
    }

    /// Invariant 9: 验证自触发衍生事件深度 <= 1
    pub fn assert_recursion_depth(current_depth: u32, max_depth: u32) -> Result<(), InvariantViolation> {
        if current_depth > max_depth {
            return Err(InvariantViolation::Invariant9RecursionDepthExceeded {
                depth: current_depth,
                max_depth,
            });
        }
        Ok(())
    }

    /// Invariant 10: 验证在熔断/降级态下只允许观察动作
    pub fn assert_degrade_state(
        circuit_breaker: &CircuitBreaker,
        action: &DiscreteDecisionAction,
    ) -> Result<(), InvariantViolation> {
        let state = circuit_breaker.state();
        match state {
            CircuitState::Healthy => Ok(()),
            CircuitState::Degraded { .. } => {
                // 降级态禁止未经用户确认的自主执行
                if matches!(action, DiscreteDecisionAction::Execute) {
                    return Err(InvariantViolation::Invariant10DegradeViolation {
                        action: action.clone(),
                    });
                }
                Ok(())
            }
            CircuitState::Open { .. } | CircuitState::Recovery { .. } => {
                // 熔断打开态严格只观察或向用户询问
                if !matches!(
                    action,
                    DiscreteDecisionAction::Ignore
                        | DiscreteDecisionAction::Remember
                        | DiscreteDecisionAction::Monitor
                        | DiscreteDecisionAction::Ask
                ) {
                    return Err(InvariantViolation::Invariant10DegradeViolation {
                        action: action.clone(),
                    });
                }
                Ok(())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_invariant_1_cancellable() {
        assert!(InvariantGuard::assert_cancellable(true, 5000).is_ok());
        assert!(InvariantGuard::assert_cancellable(false, 5000).is_err());
        assert!(InvariantGuard::assert_cancellable(true, 0).is_err());
    }

    #[test]
    fn test_invariant_2_permission() {
        assert!(InvariantGuard::assert_permission_boundary("read_file", true, false).is_ok());
        assert!(InvariantGuard::assert_permission_boundary("delete_file", false, false).is_err());
        assert!(InvariantGuard::assert_permission_boundary("delete_file", false, true).is_ok());
    }

    #[test]
    fn test_invariant_6_debounce() {
        assert!(InvariantGuard::assert_debounce(1000, 1600, 500).is_ok());
        assert!(InvariantGuard::assert_debounce(1000, 1200, 500).is_err());
    }

    #[test]
    fn test_invariant_9_recursion() {
        assert!(InvariantGuard::assert_recursion_depth(0, 1).is_ok());
        assert!(InvariantGuard::assert_recursion_depth(1, 1).is_ok());
        assert!(InvariantGuard::assert_recursion_depth(2, 1).is_err());
    }

    #[test]
    fn test_invariant_10_degrade_state() {
        let cb = CircuitBreaker::with_default_config();
        assert!(InvariantGuard::assert_degrade_state(&cb, &DiscreteDecisionAction::Execute).is_ok());

        // 强行触发熔断
        for _ in 0..6 {
            cb.record_failure();
        }
        assert!(matches!(cb.state(), CircuitState::Open { .. }));

        // 熔断态禁止 Execute
        assert!(InvariantGuard::assert_degrade_state(&cb, &DiscreteDecisionAction::Execute).is_err());
        // 允许 Remember / Ignore
        assert!(InvariantGuard::assert_degrade_state(&cb, &DiscreteDecisionAction::Remember).is_ok());
    }
}
