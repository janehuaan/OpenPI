use serde::{Deserialize, Serialize};
use super::simulator::ReplaySimulator;

/// 帕累托综合评估结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParetoMetrics {
    /// 发现质量：回放过程中所达到的最高客观得分
    pub discovery_quality: f64,
    /// 探索成本：总探测节点数 N
    pub total_probes: usize,
    /// 决策轮数 K
    pub decision_rounds: usize,
    /// 并发效率：平均每轮决策调度的探测数 N / max(1, K)
    pub parallelism_efficiency: f64,
    /// 累计代码变动量（MDL 评估指标）
    #[serde(default)]
    pub total_churn: usize,
    /// 反事实并发重组潜在加速比（若无依赖只读动作完全并行化，可达到的并发倍率）
    #[serde(default = "default_speedup")]
    pub counterfactual_speedup: f64,
    /// 最终 Pareto 综合奖励分
    pub pareto_reward: f64,
}

fn default_speedup() -> f64 {
    1.0
}

/// 计算反事实并发重组指标（Counterfactual Action Rescheduling）
/// 在历史观察轨迹中，若存在连续只读探测动作（如连续 read, grep, cat, find），
/// 模拟在多 Worker 并发调度器下合并为单轮决策所能达到的潜在加速比。
pub fn compute_counterfactual_speedup(sim: &ReplaySimulator) -> f64 {
    let observed = sim.observed();
    if observed.len() <= 1 {
        return 1.0;
    }

    let is_read_only = |cmd: &str| -> bool {
        let c = cmd.to_lowercase();
        c.contains("read")
            || c.contains("grep")
            || c.contains("find")
            || c.contains("cat")
            || c.contains("ls")
            || c.contains("head")
            || c.contains("tail")
            || c.contains("stat")
    };

    let mut sequential_rounds = 0;
    let mut counterfactual_rounds = 0;
    let mut current_streak = 0;

    for node in &observed {
        sequential_rounds += 1;
        if is_read_only(&node.cmd) {
            current_streak += 1;
            if current_streak == 1 || current_streak > sim.max_parallelism() {
                counterfactual_rounds += 1;
                current_streak = 1;
            }
        } else {
            counterfactual_rounds += 1;
            current_streak = 0;
        }
    }

    if counterfactual_rounds > 0 {
        sequential_rounds as f64 / counterfactual_rounds as f64
    } else {
        1.0
    }
}

/// Pareto 策略多目标评估器
///
/// 严格实现 Dream-RSI 公式 (1) + MDL 极简代码惩罚:
/// V = max(score) - beta1 * N + beta2 * (N / max(1, K)) - gamma * ln(1 + total_churn)
pub struct ParetoEvaluator {
    pub beta1: f64, // 步数惩罚系数
    pub beta2: f64, // 并发效率奖励系数
    pub gamma: f64, // 代码改动极简度（MDL Churn）惩罚系数
}

impl Default for ParetoEvaluator {
    fn default() -> Self {
        Self {
            beta1: 0.005, // 步数惩罚系数
            beta2: 0.05,  // 并发效率奖励系数
            gamma: 0.015, // MDL 代码膨胀惩罚系数
        }
    }
}

impl ParetoEvaluator {
    pub fn new(beta1: f64, beta2: f64) -> Self {
        Self { beta1, beta2, gamma: 0.015 }
    }

    pub fn with_gamma(beta1: f64, beta2: f64, gamma: f64) -> Self {
        Self { beta1, beta2, gamma }
    }

    /// 评估一次完整的做梦回放过程
    pub fn evaluate(&self, sim: &ReplaySimulator) -> ParetoMetrics {
        let discovery_quality = sim.best_score();
        let total_probes = sim.probe_count();
        let decision_rounds = sim.decision_rounds();
        let total_churn = sim.total_churn();
        let counterfactual_speedup = compute_counterfactual_speedup(sim);

        let parallelism_efficiency = if decision_rounds == 0 {
            0.0
        } else {
            total_probes as f64 / decision_rounds.max(1) as f64
        };

        // MDL 代码膨胀对数惩罚：改动越小（且达到目标分），奖励越高
        let churn_penalty = if total_churn > 0 {
            self.gamma * (1.0 + total_churn as f64).ln()
        } else {
            0.0
        };

        let pareto_reward = discovery_quality
            - self.beta1 * (total_probes as f64)
            + self.beta2 * parallelism_efficiency
            - churn_penalty;

        ParetoMetrics {
            discovery_quality,
            total_probes,
            decision_rounds,
            parallelism_efficiency,
            total_churn,
            counterfactual_speedup,
            pareto_reward,
        }
    }
}
