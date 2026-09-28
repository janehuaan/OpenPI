use serde::{Deserialize, Serialize};

/// 错误类型分级（Dream-RSI 核心：区分实现级报错与算法级失败）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FailureClass {
    /// 评估成功，无错误
    Ok,
    /// 可自愈的实现级失误（如语法错误、缺少依赖、类型不匹配、显存溢出、临时超时）
    /// 这类错误绝不允许直接判算法方向死刑，保留恢复重试资格
    RepairableImplementation {
        reason: String,
        error_sample: String,
    },
    /// 致命的算法/逻辑级失败（如根本性数学矛盾、死锁、无法自洽的算法设计）
    HardAlgorithmic {
        reason: String,
    },
    /// 运行环境或依赖设施问题（如 sandbox 崩溃、网络不可达）
    EnvironmentFailure {
        reason: String,
    },
}

impl FailureClass {
    pub fn is_ok(&self) -> bool {
        matches!(self, FailureClass::Ok)
    }

    pub fn is_repairable(&self) -> bool {
        matches!(self, FailureClass::RepairableImplementation { .. })
    }

    pub fn is_hard_failure(&self) -> bool {
        matches!(self, FailureClass::HardAlgorithmic { .. })
    }
}

/// 探索调度角色分配（动态资产组合）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScheduleRole {
    /// 深入利用：基于当前最高分或有显著进展的分支继续深入
    Exploitation,
    /// 多样探索：开拓全新 root 或探索度低的分支，避免局部收敛
    Exploration,
    /// 容错自愈：为此前遭遇可自愈错误的分支分配 1 个重试工位（分支赦免）
    Recovery,
}

/// 任务情境分类（情境化分层做梦）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TaskContext {
    /// 定位与修复 Bug（偏深度收敛利用）
    QuickFix,
    /// 跨文件/模块架构重构（偏广度探索与依赖核对）
    Refactor,
    /// 未知环境与开源项目探索调研
    Exploration,
    /// 通用平衡型任务
    General,
}

impl Default for TaskContext {
    fn default() -> Self {
        Self::General
    }
}

impl TaskContext {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::QuickFix => "quick_fix",
            Self::Refactor => "refactor",
            Self::Exploration => "exploration",
            Self::General => "general",
        }
    }
}

/// 发现树中的单个执行节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub branch_id: usize,
    pub step: usize,
    pub cmd: String,
    pub output_summary: String,
    pub score: f64,
    pub fail_class: FailureClass,
    pub execution_ms: u64,
    pub is_leaf: bool,
    pub is_closed: bool,
    pub created_at: u64,
    /// 代码变动行数（MDL 最小描述长度惩罚项）
    #[serde(default)]
    pub churn_lines: usize,
}

impl DiscoveryNode {
    pub fn new(
        id: impl Into<String>,
        parent_id: Option<String>,
        branch_id: usize,
        step: usize,
        cmd: impl Into<String>,
        output_summary: impl Into<String>,
        score: f64,
        fail_class: FailureClass,
        execution_ms: u64,
    ) -> Self {
        Self {
            id: id.into(),
            parent_id,
            branch_id,
            step,
            cmd: cmd.into(),
            output_summary: output_summary.into(),
            score,
            fail_class,
            execution_ms,
            is_leaf: true,
            is_closed: false,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            churn_lines: 0,
        }
    }

    pub fn with_churn(mut self, churn: usize) -> Self {
        self.churn_lines = churn;
        self
    }
}
