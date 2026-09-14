use petgraph::algo::toposort;
use petgraph::graph::{DiGraph, NodeIndex};
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStep {
    pub id: String,
    pub title: String,
    pub prompt: String,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub tools: Vec<String>,
}

pub struct DagEngine {
    graph: DiGraph<TaskStep, ()>,
    node_indices: HashMap<String, NodeIndex>,
}

impl DagEngine {
    pub fn new() -> Self {
        Self {
            graph: DiGraph::new(),
            node_indices: HashMap::new(),
        }
    }

    pub fn from_steps(steps: &[TaskStep]) -> anyhow::Result<Self> {
        let mut engine = Self::new();
        for step in steps {
            let idx = engine.graph.add_node(step.clone());
            engine.node_indices.insert(step.id.clone(), idx);
        }

        for step in steps {
            for dep in &step.depends_on {
                if let (Some(&parent), Some(&child)) = (engine.node_indices.get(dep), engine.node_indices.get(&step.id)) {
                    engine.graph.add_edge(parent, child, ());
                } else {
                    anyhow::bail!("Step {} depends on unknown step {}", step.id, dep);
                }
            }
        }

        Ok(engine)
    }

    /// Topologically sorts the steps into executable sequence
    pub fn plan_execution(&self) -> Result<Vec<TaskStep>, String> {
        match toposort(&self.graph, None) {
            Ok(nodes) => Ok(nodes.into_iter().map(|idx| self.graph[idx].clone()).collect()),
            Err(_) => Err("Cycle detected in DAG task steps".to_string()),
        }
    }
}
