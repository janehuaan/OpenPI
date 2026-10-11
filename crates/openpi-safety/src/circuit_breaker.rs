//! 熔断器机制与执行硬约束 (Circuit Breaker & Execution Constraint)
//!
//! 核心原则：
//! 1. 系统拒绝将执行故障简单视为普通异常，设立全局与会话级的健康状态机。
//! 2. 状态转移：HEALTHY -> DEGRADED -> CIRCUIT_OPEN -> RECOVERY -> HEALTHY。
//! 3. 执行硬预算包 (Execution Budget Envelope) 保证 Personal Agent 绝不能将底层推入无限循环。

use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum CircuitState {
    Healthy,
    Degraded {
        consecutive_failures: u32,
    },
    Open {
        opened_at: i64,
        cooldown_ms: u64,
    },
    Recovery {
        probe_successes: u32,
        required_successes: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitBreakerConfig {
    pub failure_threshold_degraded: u32,
    pub failure_threshold_open: u32,
    pub cooldown_ms: u64,
    pub required_recovery_probes: u32,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold_degraded: 3,
            failure_threshold_open: 5,
            cooldown_ms: 30_000,
            required_recovery_probes: 2,
        }
    }
}

/// 执行硬预算约束包 (Execution Constraint Envelope)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionConstraint {
    /// 最大执行时间 (单步 <= 60s, 流水线 <= 600s)
    pub timeout_ms: u64,
    /// CPU 相对配额
    pub cpu_quota: Option<f32>,
    /// 内存硬阈值 (超限直接隔离退出)
    pub memory_limit_mb: u64,
    /// 最大重试次数 (默认 <= 2 次，指数退避)
    pub retry_budget: u32,
    /// 并发限制 (全局 <= 3, 会话 <= 1)
    pub concurrency_limit: u32,
    /// 最大输出大小 (默认 <= 2MB, 防终端爆内存)
    pub output_limit_bytes: u64,
    /// 单轮工具最大调用次数 (<= 15)
    pub tool_call_limit: u32,
    /// 子 Agent 递归深度 (<= 2)
    pub recursive_agent_depth: u32,
    /// 全局强停标志
    pub global_kill_switch: bool,
}

impl Default for ExecutionConstraint {
    fn default() -> Self {
        Self {
            timeout_ms: 60_000,
            cpu_quota: None,
            memory_limit_mb: 512,
            retry_budget: 2,
            concurrency_limit: 3,
            output_limit_bytes: 2 * 1024 * 1024,
            tool_call_limit: 15,
            recursive_agent_depth: 2,
            global_kill_switch: false,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CircuitBreaker {
    config: CircuitBreakerConfig,
    state: Arc<RwLock<CircuitState>>,
    consecutive_failures: Arc<RwLock<u32>>,
}

impl CircuitBreaker {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            config,
            state: Arc::new(RwLock::new(CircuitState::Healthy)),
            consecutive_failures: Arc::new(RwLock::new(0)),
        }
    }

    pub fn with_default_config() -> Self {
        Self::new(CircuitBreakerConfig::default())
    }

    /// 获取当前熔断状态（会自动检测 Open 是否已过冷却期转入 Recovery）
    pub fn state(&self) -> CircuitState {
        let now = chrono::Utc::now().timestamp_millis();
        let mut state_guard = self.state.write().unwrap();
        if let CircuitState::Open { opened_at, cooldown_ms } = *state_guard {
            if (now - opened_at) as u64 >= cooldown_ms {
                *state_guard = CircuitState::Recovery {
                    probe_successes: 0,
                    required_successes: self.config.required_recovery_probes,
                };
            }
        }
        state_guard.clone()
    }

    /// 是否允许自主行动
    pub fn is_autonomous_action_allowed(&self) -> bool {
        match self.state() {
            CircuitState::Healthy => true,
            CircuitState::Degraded { .. } => false, // 降级：仅允许显式用户指令
            CircuitState::Open { .. } => false,     // 熔断打开：只观察、不行动
            CircuitState::Recovery { .. } => false, // 探针恢复中：仅允许受限探测
        }
    }

    /// 是否处于探针探测状态
    pub fn is_in_recovery_probe(&self) -> bool {
        matches!(self.state(), CircuitState::Recovery { .. })
    }

    /// 记录一次成功事件
    pub fn record_success(&self) {
        let mut state_guard = self.state.write().unwrap();
        let mut failures_guard = self.consecutive_failures.write().unwrap();
        *failures_guard = 0;

        match &mut *state_guard {
            CircuitState::Healthy => {}
            CircuitState::Degraded { .. } => {
                *state_guard = CircuitState::Healthy;
            }
            CircuitState::Open { .. } => {
                // Open 态不直接由常规成功重置，必须经过冷却和探针
            }
            CircuitState::Recovery {
                probe_successes,
                required_successes,
            } => {
                *probe_successes += 1;
                if *probe_successes >= *required_successes {
                    *state_guard = CircuitState::Healthy;
                }
            }
        }
    }

    /// 记录一次执行失败事件
    pub fn record_failure(&self) {
        let now = chrono::Utc::now().timestamp_millis();
        let mut state_guard = self.state.write().unwrap();
        let mut failures_guard = self.consecutive_failures.write().unwrap();
        *failures_guard += 1;
        let failures = *failures_guard;

        match *state_guard {
            CircuitState::Healthy => {
                if failures >= self.config.failure_threshold_open {
                    *state_guard = CircuitState::Open {
                        opened_at: now,
                        cooldown_ms: self.config.cooldown_ms,
                    };
                } else if failures >= self.config.failure_threshold_degraded {
                    *state_guard = CircuitState::Degraded {
                        consecutive_failures: failures,
                    };
                }
            }
            CircuitState::Degraded { .. } => {
                if failures >= self.config.failure_threshold_open {
                    *state_guard = CircuitState::Open {
                        opened_at: now,
                        cooldown_ms: self.config.cooldown_ms,
                    };
                } else {
                    *state_guard = CircuitState::Degraded {
                        consecutive_failures: failures,
                    };
                }
            }
            CircuitState::Open { .. } => {
                // 已处于打开状态，保持并重置打开时间
                *state_guard = CircuitState::Open {
                    opened_at: now,
                    cooldown_ms: self.config.cooldown_ms,
                };
            }
            CircuitState::Recovery { .. } => {
                // 探针失败立即重新击穿回 Open
                *state_guard = CircuitState::Open {
                    opened_at: now,
                    cooldown_ms: self.config.cooldown_ms,
                };
            }
        }
    }

    /// 手动强制重置为 Healthy
    pub fn force_reset(&self) {
        let mut state_guard = self.state.write().unwrap();
        let mut failures_guard = self.consecutive_failures.write().unwrap();
        *state_guard = CircuitState::Healthy;
        *failures_guard = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit_breaker_transitions() {
        let config = CircuitBreakerConfig {
            failure_threshold_degraded: 2,
            failure_threshold_open: 4,
            cooldown_ms: 100, // 短冷却供测试
            required_recovery_probes: 2,
        };
        let cb = CircuitBreaker::new(config);

        assert_eq!(cb.state(), CircuitState::Healthy);
        assert!(cb.is_autonomous_action_allowed());

        // 1 失败：依然 Healthy
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Healthy);

        // 2 失败：转为 Degraded
        cb.record_failure();
        assert!(matches!(cb.state(), CircuitState::Degraded { .. }));
        assert!(!cb.is_autonomous_action_allowed());

        // 4 失败：转为 Open
        cb.record_failure();
        cb.record_failure();
        assert!(matches!(cb.state(), CircuitState::Open { .. }));

        // 冷却前依然 Open
        assert!(matches!(cb.state(), CircuitState::Open { .. }));

        // 等待冷却结束
        std::thread::sleep(std::time::Duration::from_millis(120));
        assert!(matches!(cb.state(), CircuitState::Recovery { .. }));

        // 恢复探针 1 次成功
        cb.record_success();
        assert!(matches!(cb.state(), CircuitState::Recovery { probe_successes: 1, .. }));

        // 恢复探针 2 次成功 -> Healthy
        cb.record_success();
        assert_eq!(cb.state(), CircuitState::Healthy);
        assert!(cb.is_autonomous_action_allowed());
    }

    #[test]
    fn test_recovery_probe_failure_reopens_immediately() {
        let config = CircuitBreakerConfig {
            failure_threshold_degraded: 1,
            failure_threshold_open: 2,
            cooldown_ms: 50,
            required_recovery_probes: 2,
        };
        let cb = CircuitBreaker::new(config);
        cb.record_failure();
        cb.record_failure();
        assert!(matches!(cb.state(), CircuitState::Open { .. }));

        std::thread::sleep(std::time::Duration::from_millis(60));
        assert!(matches!(cb.state(), CircuitState::Recovery { .. }));

        // 探针失败立即打回 Open
        cb.record_failure();
        assert!(matches!(cb.state(), CircuitState::Open { .. }));
    }
}
