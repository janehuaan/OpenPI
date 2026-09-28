use std::collections::HashSet;
use super::tree::DiscoveryTree;
use super::types::DiscoveryNode;

/// 离线回放模拟器（Replay Simulator / World Model）
///
/// 严格遵守 Dream-RSI 的设计：
/// 1. Prefix-Only：策略控制器只能看到已经揭示的前缀状态，不可见未揭示节点得分。
/// 2. 0 Token / 0 沙箱：所有探测直接从已存盘的历史树中读出结果，微秒级执行。
/// 3. 并发批次调度：支持最多 W 个 worker 的批量动作。
#[derive(Debug, Clone)]
pub struct ReplaySimulator {
    frozen_tree: DiscoveryTree,
    revealed_nodes: HashSet<String>,
    max_parallelism: usize,
    decision_rounds: usize,
    probe_count: usize,
}

impl ReplaySimulator {
    pub fn new(tree: DiscoveryTree, max_parallelism: usize) -> Self {
        let mut revealed_nodes = HashSet::new();
        // 初始时刻仅揭示 root 节点
        revealed_nodes.insert(tree.root_id.clone());

        Self {
            frozen_tree: tree,
            revealed_nodes,
            max_parallelism,
            decision_rounds: 0,
            probe_count: 0,
        }
    }

    /// 重置回放状态至初始 root
    pub fn reset(&mut self) {
        self.revealed_nodes.clear();
        self.revealed_nodes.insert(self.frozen_tree.root_id.clone());
        self.decision_rounds = 0;
        self.probe_count = 0;
    }

    /// 获取当前已揭示的所有前缀观察（策略控制器唯一合法的决策输入）
    pub fn observed(&self) -> Vec<&DiscoveryNode> {
        self.revealed_nodes
            .iter()
            .filter_map(|id| self.frozen_tree.nodes.get(id))
            .collect()
    }

    /// 获取当前可以继续深挖的分支前沿（Frontiers）
    pub fn legal_actions(&self) -> Vec<String> {
        self.frozen_tree.legal_actions(&self.revealed_nodes)
    }

    /// 获取尚未开启的新分支起点（Unopened Roots）
    pub fn legal_roots(&self) -> Vec<String> {
        self.frozen_tree.legal_roots(&self.revealed_nodes)
    }

    /// 并发批量探测（批量揭示下一代节点）
    ///
    /// 输入为策略控制器选择的起始父节点 ID 列表（大小不超过 max_parallelism）。
    /// 返回本次探测揭示出的新子节点观察。
    pub fn probe_batch(&mut self, parent_node_ids: &[String]) -> anyhow::Result<Vec<&DiscoveryNode>> {
        if parent_node_ids.is_empty() {
            return Ok(Vec::new());
        }

        if parent_node_ids.len() > self.max_parallelism {
            anyhow::bail!(
                "Batch size {} exceeds max parallelism limit {}",
                parent_node_ids.len(),
                self.max_parallelism
            );
        }

        self.decision_rounds += 1;
        let mut newly_revealed_ids = Vec::new();

        for pid in parent_node_ids {
            // 在历史树中找到该父节点在当前分支下尚未揭示的下一个直接子节点
            let mut children = self.frozen_tree.get_children(pid);
            // 按照 step / created_at 排序确定时间先后
            children.sort_by_key(|c| c.step);

            if let Some(next_unrevealed) = children.into_iter().find(|c| !self.revealed_nodes.contains(&c.id)) {
                newly_revealed_ids.push(next_unrevealed.id.clone());
                self.revealed_nodes.insert(next_unrevealed.id.clone());
                self.probe_count += 1;
            }
        }

        let results: Vec<&DiscoveryNode> = newly_revealed_ids
            .iter()
            .filter_map(|id| self.frozen_tree.nodes.get(id))
            .collect();

        Ok(results)
    }

    /// 获取当前所有已揭示节点中的最高得分
    pub fn best_score(&self) -> f64 {
        self.frozen_tree.best_score(&self.revealed_nodes)
    }

    /// 决策轮数
    pub fn decision_rounds(&self) -> usize {
        self.decision_rounds
    }

    /// 总探测节点数
    pub fn probe_count(&self) -> usize {
        self.probe_count
    }

    /// 当前已揭示节点中的累计代码变动行数（MDL 极简度计算）
    pub fn total_churn(&self) -> usize {
        self.revealed_nodes
            .iter()
            .filter_map(|id| self.frozen_tree.nodes.get(id))
            .map(|n| n.churn_lines)
            .sum()
    }

    /// 最大并行度
    pub fn max_parallelism(&self) -> usize {
        self.max_parallelism
    }

    /// 是否所有历史节点都已经被揭示完毕
    pub fn is_exhausted(&self) -> bool {
        self.revealed_nodes.len() >= self.frozen_tree.nodes.len()
    }
}
