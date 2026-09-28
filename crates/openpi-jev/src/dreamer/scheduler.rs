use std::collections::{HashMap, HashSet};
use super::simulator::ReplaySimulator;
use super::types::{DiscoveryNode, FailureClass};

/// 动态资产组合调度器（Dynamic Portfolio Scheduler）
///
/// 核心思想：每一轮并发批次由三个互补的角色构成：
/// 1. Exploitation（深入利用）：最高分活跃分支继续向下探
/// 2. Exploration（多样探索）：开启新分支（Roots）或低探索度分支
/// 3. Recovery（容错恢复）：最多分配 1 个席位给“可自愈错误”（如语法错误、显存溢出），给好的思路重试机会
#[derive(Debug, Clone)]
pub struct DynamicPortfolioScheduler {
    pub beta: f64,
    pub max_parallelism: usize,
    pub stagnation_threshold_rounds: usize,
    recent_best_scores: Vec<f64>,
}

impl DynamicPortfolioScheduler {
    pub fn new(beta: f64, max_parallelism: usize) -> Self {
        Self {
            beta: beta.clamp(0.0, 1.0),
            max_parallelism,
            stagnation_threshold_rounds: 3,
            recent_best_scores: Vec::new(),
        }
    }

    /// 在给定当前模拟器前缀观察下，决策出下一轮并发探测的父节点批次
    pub fn select_batch(&mut self, sim: &ReplaySimulator) -> Vec<String> {
        let observed = sim.observed();
        let legal_frontiers = sim.legal_actions();
        let legal_roots = sim.legal_roots();

        // 1. 检查边际收益是否走平（Stagnation Stop）
        let current_best = sim.best_score();
        self.recent_best_scores.push(current_best);
        if self.recent_best_scores.len() > self.stagnation_threshold_rounds {
            self.recent_best_scores.remove(0);
        }

        // 低 beta 下更严格止损；高 beta 下允许更多耐心
        let required_patience = if self.beta > 0.7 { 5 } else if self.beta < 0.3 { 2 } else { 3 };
        if self.recent_best_scores.len() >= required_patience {
            let first = self.recent_best_scores[0];
            let last = *self.recent_best_scores.last().unwrap();
            // 如果连续多轮收益完全走平且探索已有相当基础，主动止损结题
            if (last - first).abs() < 1e-6 && current_best > 0.0 && self.beta < 0.8 {
                return Vec::new(); // 触发提前结题
            }
        }

        // 2. 候选节点分类与画像
        let mut node_map: HashMap<&str, &DiscoveryNode> = HashMap::new();
        for node in &observed {
            node_map.insert(&node.id, node);
        }

        let mut exploitation_candidates: Vec<(&DiscoveryNode, f64)> = Vec::new();
        let mut recovery_candidates: Vec<&DiscoveryNode> = Vec::new();

        for frontier_id in &legal_frontiers {
            if let Some(node) = node_map.get(frontier_id.as_str()) {
                match &node.fail_class {
                    FailureClass::Ok => {
                        // 正常节点：根据其分数和步长计算优先级
                        exploitation_candidates.push((node, node.score));
                    }
                    FailureClass::RepairableImplementation { .. } => {
                        // 可自愈的实现级错误：纳入 Recovery 队列
                        recovery_candidates.push(node);
                    }
                    FailureClass::HardAlgorithmic { .. } => {
                        // 算法死锁或致命错误：直接剪枝，不分配工位
                    }
                    FailureClass::EnvironmentFailure { .. } => {
                        recovery_candidates.push(node);
                    }
                }
            }
        }

        // 按照得分降序排序深入利用候选
        exploitation_candidates.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        // 3. 构建动态批次（动态分配 W 个 Worker）
        let mut selected_batch: Vec<String> = Vec::with_capacity(self.max_parallelism);
        let mut used_branches: HashSet<usize> = HashSet::new();

        // 3a. 分配 Recovery（至多 1 个配额，Dream-RSI 关键约束）
        if let Some(recover_node) = recovery_candidates.first() {
            selected_batch.push(recover_node.id.clone());
            used_branches.insert(recover_node.branch_id);
        }

        // 3b. 分配 Exploitation（高优先级深入）
        let max_exploit = if self.beta > 0.5 {
            (self.max_parallelism + 1) / 2
        } else {
            self.max_parallelism.saturating_sub(selected_batch.len())
        };

        for (node, _) in &exploitation_candidates {
            if selected_batch.len() >= self.max_parallelism {
                break;
            }
            if selected_batch.len() < max_exploit && !used_branches.contains(&node.branch_id) {
                selected_batch.push(node.id.clone());
                used_branches.insert(node.branch_id);
            }
        }

        // 3c. 分配 Exploration（开辟新根或低频分支）
        for root_id in &legal_roots {
            if selected_batch.len() >= self.max_parallelism {
                break;
            }
            if !selected_batch.contains(root_id) {
                selected_batch.push(root_id.clone());
            }
        }

        // 3d. 若仍有空位，填补剩余的有效利用节点
        for (node, _) in &exploitation_candidates {
            if selected_batch.len() >= self.max_parallelism {
                break;
            }
            if !selected_batch.contains(&node.id) {
                selected_batch.push(node.id.clone());
            }
        }

        selected_batch
    }
}
