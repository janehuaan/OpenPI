//! 分层资源预算管理器 (Resource Budget Manager)
//!
//! 规范要求：
//! 1. 分层预算拓扑：Global Budget -> 30% Personal Agent / 70% Execution Core
//! 2. 资源生命周期：Reserve (预扣) -> Execute (执行) -> Meter (计量) -> Release (释放) -> Report (报告)
//! 3. 预算余量作为决策引擎输入：预算紧张时主动降级。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BudgetError {
    #[error("预算不足: 请求 {requested}, 剩余可用 {available} (类别: {category:?})")]
    QuotaExceeded {
        category: BudgetCategory,
        requested: u64,
        available: u64,
    },
    #[error("无效的预扣令牌: {0}")]
    InvalidReservation(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BudgetCategory {
    // 30% Personal Agent 配额
    Observation,
    Memory,
    Decision,
    Proactive,

    // 70% Execution Core 配额
    AgentLoop,
    SubagentTools,
    Workflow,
}

impl BudgetCategory {
    pub fn is_personal(&self) -> bool {
        matches!(
            self,
            Self::Observation | Self::Memory | Self::Decision | Self::Proactive
        )
    }

    pub fn is_execution(&self) -> bool {
        !self.is_personal()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetReservation {
    pub id: String,
    pub category: BudgetCategory,
    pub reserved_amount: u64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetUsageReport {
    pub total_limit: u64,
    pub personal_limit: u64,
    pub personal_reserved: u64,
    pub personal_used: u64,
    pub execution_limit: u64,
    pub execution_reserved: u64,
    pub execution_used: u64,
    pub total_remaining: u64,
    pub is_critical: bool,
}

#[derive(Debug)]
struct InnerBudget {
    total_limit: u64,
    personal_limit: u64,
    execution_limit: u64,

    personal_used: u64,
    execution_used: u64,

    active_reservations: HashMap<String, BudgetReservation>,
}

#[derive(Debug, Clone)]
pub struct ResourceBudgetManager {
    inner: Arc<RwLock<InnerBudget>>,
}

impl ResourceBudgetManager {
    pub fn new(total_limit: u64) -> Self {
        // 30% Personal, 70% Execution
        let personal_limit = (total_limit as f64 * 0.30).round() as u64;
        let execution_limit = total_limit.saturating_sub(personal_limit);

        Self {
            inner: Arc::new(RwLock::new(InnerBudget {
                total_limit,
                personal_limit,
                execution_limit,
                personal_used: 0,
                execution_used: 0,
                active_reservations: HashMap::new(),
            })),
        }
    }

    /// 预扣配额 (Reserve)
    pub fn reserve(&self, category: BudgetCategory, amount: u64) -> Result<String, BudgetError> {
        let mut budget = self.inner.write().unwrap();
        let (limit, used, active_reserved) = if category.is_personal() {
            let reserved: u64 = budget
                .active_reservations
                .values()
                .filter(|r| r.category.is_personal())
                .map(|r| r.reserved_amount)
                .sum();
            (budget.personal_limit, budget.personal_used, reserved)
        } else {
            let reserved: u64 = budget
                .active_reservations
                .values()
                .filter(|r| r.category.is_execution())
                .map(|r| r.reserved_amount)
                .sum();
            (budget.execution_limit, budget.execution_used, reserved)
        };

        let current_committed = used.saturating_add(active_reserved);
        let available = limit.saturating_sub(current_committed);

        if amount > available {
            return Err(BudgetError::QuotaExceeded {
                category,
                requested: amount,
                available,
            });
        }

        let reservation_id = uuid::Uuid::new_v4().to_string();
        budget.active_reservations.insert(
            reservation_id.clone(),
            BudgetReservation {
                id: reservation_id.clone(),
                category,
                reserved_amount: amount,
                created_at: chrono::Utc::now().timestamp_millis(),
            },
        );

        Ok(reservation_id)
    }

    /// 实时遥测与结算入账 (Meter)
    pub fn meter(&self, reservation_id: &str, actual_used: u64) -> Result<(), BudgetError> {
        let mut budget = self.inner.write().unwrap();
        let reservation = budget
            .active_reservations
            .remove(reservation_id)
            .ok_or_else(|| BudgetError::InvalidReservation(reservation_id.to_string()))?;

        if reservation.category.is_personal() {
            budget.personal_used = budget.personal_used.saturating_add(actual_used);
        } else {
            budget.execution_used = budget.execution_used.saturating_add(actual_used);
        }

        Ok(())
    }

    /// 释放预扣配额，未执行任何开销 (Release)
    pub fn release(&self, reservation_id: &str) -> Result<(), BudgetError> {
        let mut budget = self.inner.write().unwrap();
        if budget.active_reservations.remove(reservation_id).is_none() {
            return Err(BudgetError::InvalidReservation(reservation_id.to_string()));
        }
        Ok(())
    }

    /// 查询当前预算报告
    pub fn report(&self) -> BudgetUsageReport {
        let budget = self.inner.read().unwrap();
        let personal_reserved: u64 = budget
            .active_reservations
            .values()
            .filter(|r| r.category.is_personal())
            .map(|r| r.reserved_amount)
            .sum();

        let execution_reserved: u64 = budget
            .active_reservations
            .values()
            .filter(|r| r.category.is_execution())
            .map(|r| r.reserved_amount)
            .sum();

        let total_committed = budget
            .personal_used
            .saturating_add(personal_reserved)
            .saturating_add(budget.execution_used)
            .saturating_add(execution_reserved);

        let total_remaining = budget.total_limit.saturating_sub(total_committed);
        let usage_ratio = if budget.total_limit > 0 {
            total_committed as f64 / budget.total_limit as f64
        } else {
            1.0
        };

        BudgetUsageReport {
            total_limit: budget.total_limit,
            personal_limit: budget.personal_limit,
            personal_reserved,
            personal_used: budget.personal_used,
            execution_limit: budget.execution_limit,
            execution_reserved,
            execution_used: budget.execution_used,
            total_remaining,
            is_critical: usage_ratio >= 0.85,
        }
    }

    /// 预算是否进入告急状态 (使用率 >= 85%)
    pub fn is_budget_critical(&self) -> bool {
        self.report().is_critical
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_budget_reservation_and_metering() {
        let manager = ResourceBudgetManager::new(100_000);
        let report = manager.report();
        assert_eq!(report.personal_limit, 30_000);
        assert_eq!(report.execution_limit, 70_000);
        assert!(!report.is_critical);

        // 预扣 Personal 配额
        let res1 = manager.reserve(BudgetCategory::Observation, 5_000).unwrap();
        let report_after_res = manager.report();
        assert_eq!(report_after_res.personal_reserved, 5_000);

        // 结算 Meter
        manager.meter(&res1, 4_200).unwrap();
        let report_after_meter = manager.report();
        assert_eq!(report_after_meter.personal_reserved, 0);
        assert_eq!(report_after_meter.personal_used, 4_200);

        // 预扣超额应被拒绝
        let err = manager.reserve(BudgetCategory::Memory, 35_000).unwrap_err();
        assert!(matches!(err, BudgetError::QuotaExceeded { .. }));
    }

    #[test]
    fn test_budget_release() {
        let manager = ResourceBudgetManager::new(10_000);
        let res = manager.reserve(BudgetCategory::AgentLoop, 5_000).unwrap();
        assert_eq!(manager.report().execution_reserved, 5_000);

        // 取消任务，释放配额
        manager.release(&res).unwrap();
        assert_eq!(manager.report().execution_reserved, 0);
        assert_eq!(manager.report().execution_used, 0);
    }
}
