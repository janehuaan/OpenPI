use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use super::types::{DiscoveryNode, FailureClass, TaskContext};

/// 发现树结构：管理一个长程任务中的所有探索分支和尝试节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveryTree {
    pub root_id: String,
    pub nodes: HashMap<String, DiscoveryNode>,
    pub branches: HashMap<usize, Vec<String>>,
    #[serde(default)]
    pub context: TaskContext,
}

impl DiscoveryTree {
    pub fn new(root_id: impl Into<String>) -> Self {
        let root_id_str = root_id.into();
        let mut nodes = HashMap::new();
        // 根节点代表工作区初始状态
        let root_node = DiscoveryNode::new(
            root_id_str.clone(),
            None,
            0,
            0,
            "root:init",
            "Initial workspace baseline",
            0.0,
            FailureClass::Ok,
            0,
        );
        nodes.insert(root_id_str.clone(), root_node);

        Self {
            root_id: root_id_str,
            nodes,
            branches: HashMap::new(),
            context: TaskContext::General,
        }
    }

    pub fn with_context(mut self, context: TaskContext) -> Self {
        self.context = context;
        self
    }

    /// 向树中追加一个新节点
    pub fn add_node(&mut self, node: DiscoveryNode) -> anyhow::Result<()> {
        let node_id = node.id.clone();
        let parent_id = node.parent_id.clone();
        let branch_id = node.branch_id;

        // 如果存在父节点，将其 is_leaf 标记置为 false
        if let Some(pid) = &parent_id {
            if let Some(parent) = self.nodes.get_mut(pid) {
                parent.is_leaf = false;
            } else {
                anyhow::bail!("Parent node '{}' not found in DiscoveryTree", pid);
            }
        }

        self.branches
            .entry(branch_id)
            .or_default()
            .push(node_id.clone());
        self.nodes.insert(node_id, node);
        Ok(())
    }

    /// 获取特定节点对应的完整历史溯源轨迹（从 root 到当前节点）
    pub fn get_trajectory(&self, node_id: &str) -> Vec<&DiscoveryNode> {
        let mut trajectory = Vec::new();
        let mut curr_id = Some(node_id.to_string());

        while let Some(id) = curr_id {
            if let Some(node) = self.nodes.get(&id) {
                trajectory.push(node);
                curr_id = node.parent_id.clone();
            } else {
                break;
            }
        }

        trajectory.reverse();
        trajectory
    }

    /// 获取当前已揭示前缀树（Revealed Subtree）的所有合法可继续延伸动作（叶子节点）
    pub fn legal_actions(&self, revealed: &HashSet<String>) -> Vec<String> {
        let mut actions = Vec::new();
        for id in revealed {
            if let Some(_node) = self.nodes.get(id) {
                // 如果该节点在完整历史树中有子节点，且该子节点尚未在 revealed 中被揭示
                for child in self.get_children(id) {
                    if !revealed.contains(&child.id) {
                        actions.push(id.clone());
                        break;
                    }
                }
            }
        }
        actions
    }

    /// 获取尚未被开启的分支根节点（从全局 root 派生的首步节点）
    pub fn legal_roots(&self, revealed: &HashSet<String>) -> Vec<String> {
        let mut roots = Vec::new();
        for child in self.get_children(&self.root_id) {
            if !revealed.contains(&child.id) {
                roots.push(child.id.clone());
            }
        }
        roots
    }

    /// 获取某个节点的直接子节点
    pub fn get_children(&self, parent_id: &str) -> Vec<&DiscoveryNode> {
        self.nodes
            .values()
            .filter(|n| n.parent_id.as_deref() == Some(parent_id))
            .collect()
    }

    /// 获取当前揭示子树中的最高得分
    pub fn best_score(&self, revealed: &HashSet<String>) -> f64 {
        revealed
            .iter()
            .filter_map(|id| self.nodes.get(id))
            .map(|n| n.score)
            .fold(0.0, f64::max)
    }

    /// 获取树的总节点数（不含 root）
    pub fn total_probes(&self) -> usize {
        self.nodes.len().saturating_sub(1)
    }
}
