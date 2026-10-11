//! 系统内置事件总线 (Agent Event Bus)
//!
//! 核心原则：
//! 1. 改变 Agent 只能等待用户发送文字的被动死穴，让 Agent 能够主动感知系统事件。
//! 2. 事件驱动 (Event-Driven)：接收 FileChanged, GitUncommitted, TimerExpired, SessionIdle, Feedback 等事件。
//! 3. 异步非阻塞广播分发。

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub id: String,
    pub event_type: String, // file_changed | git_uncommitted | timer_expired | session_idle | feedback | morning_brief
    pub timestamp: u64,
    pub source: String,
    pub payload: serde_json::Value,
    pub importance: f32, // 0.0 ~ 1.0
}

#[derive(Clone)]
pub struct EventBus {
    sender: Arc<broadcast::Sender<AgentEvent>>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(256)
    }
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity.max(16));
        Self {
            sender: Arc::new(sender),
        }
    }

    /// 发射一个系统事件
    pub fn publish(&self, event: AgentEvent) -> usize {
        self.sender.send(event).unwrap_or(0)
    }

    /// 订阅事件流
    pub fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.sender.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_event_bus_broadcast() {
        let bus = EventBus::new(32);
        let mut rx = bus.subscribe();

        let event = AgentEvent {
            id: "evt-1".into(),
            event_type: "timer_expired".into(),
            timestamp: 12345678,
            source: "scheduler".into(),
            payload: serde_json::json!({ "timerId": "morning_brief" }),
            importance: 0.9,
        };

        bus.publish(event);
        let received = rx.recv().await.unwrap();
        assert_eq!(received.id, "evt-1");
        assert_eq!(received.event_type, "timer_expired");
    }
}
