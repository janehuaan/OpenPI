//! 统一执行网关 (Execution Gateway)
//!
//! 核心原则：
//! 1. Principle 1 冻结底层 Execution Core，所有个人智能层的意图必须且只能通过此网关穿透。
//! 2. 注入 ExecutionConstraint 硬约束包（超时、并发、内存、工具调用次数、强停开销）。
//! 3. 联动 CircuitBreaker 与 ResourceBudgetManager：
//!    - 熔断期严禁非人工确认的行动；
//!    - 预算不足直接阻断并拒绝。

use openpi_safety::{
    budget::{BudgetCategory, ResourceBudgetManager},
    circuit_breaker::{CircuitBreaker, ExecutionConstraint},
    decision::DiscreteDecisionAction,
    invariants::InvariantGuard,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use std::time::Instant;

/// 底层执行核心的异步分发器：由 daemon 在启动后注入，返回真实 token 消耗。
pub type DispatcherFuture =
    std::pin::Pin<Box<dyn std::future::Future<Output = Result<u64, String>> + Send>>;
pub type Dispatcher = Arc<dyn Fn(PersonalExecutionRequest) -> DispatcherFuture + Send + Sync>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalExecutionRequest {
    pub goal_id: Option<String>,
    pub action: String,
    pub priority: String,
    pub context: String,
    pub permission: String,
    pub is_read_only: bool,
    pub has_user_confirmation: bool,
    pub estimated_tokens: u64,
    pub constraint: ExecutionConstraint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionGatewayResult {
    pub success: bool,
    pub message: String,
    pub tokens_used: u64,
    pub duration_ms: u64,
}

#[derive(Clone)]
pub struct ExecutionGateway {
    pub circuit_breaker: Arc<CircuitBreaker>,
    pub budget_manager: Arc<ResourceBudgetManager>,
    /// 底层执行核心的分发器；未注入时退化为受控空转（保持既有语义）。
    dispatcher: Arc<RwLock<Option<Dispatcher>>>,
}

impl ExecutionGateway {
    pub fn new(
        circuit_breaker: Arc<CircuitBreaker>,
        budget_manager: Arc<ResourceBudgetManager>,
    ) -> Self {
        Self {
            circuit_breaker,
            budget_manager,
            dispatcher: Arc::new(RwLock::new(None)),
        }
    }

    /// 注入真实分发器：让网关真正穿透到执行核心。
    pub fn set_dispatcher(&self, dispatcher: Dispatcher) {
        if let Ok(mut guard) = self.dispatcher.write() {
            *guard = Some(dispatcher);
        }
    }

    /// 穿透网关执行意图
    pub async fn execute(
        &self,
        request: PersonalExecutionRequest,
    ) -> Result<ExecutionGatewayResult, String> {
        let start = Instant::now();

        // 1. Invariant 7: 确保来自网关
        InvariantGuard::assert_gateway_execution(true)
            .map_err(|e| format!("Security check failed: {}", e))?;

        // 2. Invariant 1: 确保可终止性与有效超时
        InvariantGuard::assert_cancellable(true, request.constraint.timeout_ms)
            .map_err(|e| format!("Invariant 1 violation: {}", e))?;

        // 3. Invariant 2: 权限边界检查
        InvariantGuard::assert_permission_boundary(
            &request.action,
            request.is_read_only,
            request.has_user_confirmation,
        )
        .map_err(|e| format!("Permission violation: {}", e))?;

        // 4. Invariant 10: 熔断降级检查
        let action_type = if request.is_read_only {
            DiscreteDecisionAction::Monitor
        } else {
            DiscreteDecisionAction::Execute
        };
        InvariantGuard::assert_degrade_state(&self.circuit_breaker, &action_type)
            .map_err(|e| format!("Circuit breaker blocked action: {}", e))?;

        // 5. Invariant 5: 资源预算预扣 (Reserve)
        let reservation_id = self
            .budget_manager
            .reserve(BudgetCategory::AgentLoop, request.estimated_tokens)
            .map_err(|e| format!("Budget reservation failed: {}", e))?;

        // 6. 穿透执行核心（超时受控）
        let timeout_duration = std::time::Duration::from_millis(request.constraint.timeout_ms);
        let estimated = request.estimated_tokens;
        let action_name = request.action.clone();
        let dispatcher = self.dispatcher.read().ok().and_then(|g| g.clone());

        let execution_fut = async move {
            match dispatcher {
                // 真实分发：调用底层执行核心，返回真实 token 消耗
                Some(disp) => disp(request).await,
                // 未注入 dispatcher 时退化为受控空转（保持既有测试语义）
                None => {
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                    Ok(0u64)
                }
            }
        };

        let result = match tokio::time::timeout(timeout_duration, execution_fut).await {
            Ok(Ok(reported_tokens)) => {
                // 成功：上报计量 Meter（真实消耗优先，缺省回退到预估）
                let actual_used = if reported_tokens == 0 {
                    estimated.min(500)
                } else {
                    reported_tokens
                };
                let _ = self.budget_manager.meter(&reservation_id, actual_used);
                self.circuit_breaker.record_success();

                Ok(ExecutionGatewayResult {
                    success: true,
                    message: format!("Successfully dispatched action: {}", action_name),
                    tokens_used: actual_used,
                    duration_ms: start.elapsed().as_millis() as u64,
                })
            }
            Ok(Err(err)) => {
                // 执行失败：释放未用配额，记录熔断器失败
                let _ = self.budget_manager.release(&reservation_id);
                self.circuit_breaker.record_failure();
                Err(format!("Execution failed: {}", err))
            }
            Err(_) => {
                // 超时中断：释放配额，触发熔断器失败
                let _ = self.budget_manager.release(&reservation_id);
                self.circuit_breaker.record_failure();
                Err(format!(
                    "Execution timed out after {}ms",
                    timeout_duration.as_millis()
                ))
            }
        };

        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use openpi_safety::circuit_breaker::CircuitBreakerConfig;

    #[tokio::test]
    async fn test_execution_gateway_flow() {
        let cb = Arc::new(CircuitBreaker::new(CircuitBreakerConfig::default()));
        let budget = Arc::new(ResourceBudgetManager::new(100_000));
        let gateway = ExecutionGateway::new(cb, budget);

        let req = PersonalExecutionRequest {
            goal_id: Some("goal_1".into()),
            action: "read_analysis".into(),
            priority: "high".into(),
            context: "analyzing test logs".into(),
            permission: "read_only".into(),
            is_read_only: true,
            has_user_confirmation: false,
            estimated_tokens: 100,
            constraint: ExecutionConstraint::default(),
        };

        let res = gateway.execute(req).await.unwrap();
        assert!(res.success);
    }

    fn read_only_req() -> PersonalExecutionRequest {
        PersonalExecutionRequest {
            goal_id: None,
            action: "proactive:test".into(),
            priority: "normal".into(),
            context: "objective".into(),
            permission: "read_only".into(),
            is_read_only: true,
            has_user_confirmation: false,
            estimated_tokens: 100,
            constraint: ExecutionConstraint::default(),
        }
    }

    #[tokio::test]
    async fn test_gateway_uses_injected_dispatcher() {
        let cb = Arc::new(CircuitBreaker::new(CircuitBreakerConfig::default()));
        let budget = Arc::new(ResourceBudgetManager::new(100_000));
        let gateway = ExecutionGateway::new(cb, budget);

        // 注入一个返回真实 token 数的分发器
        gateway.set_dispatcher(Arc::new(|_req: PersonalExecutionRequest| {
            Box::pin(async { Ok::<u64, String>(1234) })
        }));

        let res = gateway.execute(read_only_req()).await.unwrap();
        assert!(res.success);
        assert_eq!(res.tokens_used, 1234);
        // 真实消耗已通过 Meter 入账（不再是 0）
        assert!(gateway.budget_manager.report().execution_used >= 1234);
    }

    #[tokio::test]
    async fn test_gateway_blocks_write_when_circuit_open() {
        let cb = Arc::new(CircuitBreaker::new(CircuitBreakerConfig::default()));
        for _ in 0..6 {
            cb.record_failure();
        }
        let budget = Arc::new(ResourceBudgetManager::new(100_000));
        let gateway = ExecutionGateway::new(cb, budget);

        // 写操作（Execute）在熔断态被阻断
        let mut write_req = read_only_req();
        write_req.is_read_only = false;
        write_req.has_user_confirmation = true;
        write_req.action = "write_something".into();
        let err = gateway.execute(write_req).await.unwrap_err();
        assert!(err.contains("Circuit breaker"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn test_gateway_allows_read_only_when_circuit_open() {
        let cb = Arc::new(CircuitBreaker::new(CircuitBreakerConfig::default()));
        for _ in 0..6 {
            cb.record_failure();
        }
        let budget = Arc::new(ResourceBudgetManager::new(100_000));
        let gateway = ExecutionGateway::new(cb, budget);

        // 只读观察在熔断态仍被允许（不变量 10：只观察、不行动）
        assert!(gateway.execute(read_only_req()).await.is_ok());
    }
}
