use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub id: String,
    pub session_id: String,
    pub step_index: usize,
    pub description: String,
    pub created_at: String,
    pub state_data: serde_json::Value,
}

#[derive(Default)]
pub struct SessionStateManager {
    checkpoints: HashMap<String, Vec<Checkpoint>>,
}

impl SessionStateManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn save_checkpoint(
        &mut self,
        session_id: &str,
        step_index: usize,
        description: &str,
        state_data: serde_json::Value,
    ) -> Checkpoint {
        let now = chrono::Utc::now().to_rfc3339();
        let cp = Checkpoint {
            id: format!("cp-{}-{}", session_id, step_index),
            session_id: session_id.to_string(),
            step_index,
            description: description.to_string(),
            created_at: now,
            state_data,
        };

        self.checkpoints
            .entry(session_id.to_string())
            .or_default()
            .push(cp.clone());

        cp
    }

    pub fn list_checkpoints(&self, session_id: &str) -> Vec<Checkpoint> {
        self.checkpoints.get(session_id).cloned().unwrap_or_default()
    }

    pub fn rollback_to(&mut self, session_id: &str, step_index: usize) -> Option<Checkpoint> {
        if let Some(list) = self.checkpoints.get_mut(session_id) {
            if let Some(pos) = list.iter().position(|c| c.step_index == step_index) {
                let target = list[pos].clone();
                list.truncate(pos + 1);
                return Some(target);
            }
        }
        None
    }

    /// Prunes context turns to fit within token budget
    pub fn prune_messages(
        messages: &[serde_json::Value],
        max_turns: usize,
    ) -> Vec<serde_json::Value> {
        if messages.len() <= max_turns {
            return messages.to_vec();
        }

        // Always retain initial system/setup message (index 0) if present
        let mut pruned = Vec::new();
        if !messages.is_empty() {
            pruned.push(messages[0].clone());
        }

        let retain_tail = max_turns.saturating_sub(1);
        let start = messages.len().saturating_sub(retain_tail);
        for m in &messages[start..] {
            pruned.push(m.clone());
        }

        pruned
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_checkpoint_and_rollback() {
        let mut mgr = SessionStateManager::new();
        mgr.save_checkpoint("s1", 1, "Initial file read", serde_json::json!({"file": "a.txt"}));
        mgr.save_checkpoint("s1", 2, "Edited file", serde_json::json!({"file": "a.txt", "lines": 10}));
        mgr.save_checkpoint("s1", 3, "Ran tests", serde_json::json!({"passed": false}));

        let list = mgr.list_checkpoints("s1");
        assert_eq!(list.len(), 3);

        let rolled = mgr.rollback_to("s1", 2).unwrap();
        assert_eq!(rolled.step_index, 2);
        assert_eq!(mgr.list_checkpoints("s1").len(), 2);
    }

    #[test]
    fn test_prune_messages() {
        let msgs: Vec<serde_json::Value> = (0..10)
            .map(|i| serde_json::json!({"role": "user", "turn": i}))
            .collect();
        let pruned = SessionStateManager::prune_messages(&msgs, 4);
        assert_eq!(pruned.len(), 4);
        assert_eq!(pruned[0]["turn"], 0); // preserves system/start
        assert_eq!(pruned[3]["turn"], 9); // preserves tail
    }
}
