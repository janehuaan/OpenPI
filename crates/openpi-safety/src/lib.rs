//! OpenPI Safety & Reliability Defense System
//!
//! 提供系统四大安全防线与十大底线不变量保护：
//! 1. 熔断状态机与故障隔离 (Circuit Breaker)
//! 2. 资源分层预算管理器 (Resource Budget Manager)
//! 3. 学习防污染与归因回滚层 (Learning Attribution & Rollback)
//! 4. 离散可测决策引擎 (Deterministic Decision Engine)
//! 5. 十大系统不变量看门狗 (Ten System Invariants Guard)

pub mod attribution;
pub mod budget;
pub mod circuit_breaker;
pub mod decision;
pub mod invariants;

pub use attribution::*;
pub use budget::*;
pub use circuit_breaker::*;
pub use decision::*;
pub use invariants::*;
