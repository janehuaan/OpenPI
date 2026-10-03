use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use serde_json::Value;

use crate::agent_loop::AgentLoop;
use crate::config::EngineConfig;
use crate::tool_registry::ToolRegistry;

struct ActiveSessionState {
    cancel_token: CancellationToken,
    model: Option<String>,
    turn_id: u64,
}

#[derive(Clone)]
pub struct EngineSessionManager {
    agent_loop: Arc<AgentLoop>,
    active_sessions: Arc<Mutex<HashMap<String, ActiveSessionState>>>,
    turn_counter: Arc<std::sync::atomic::AtomicU64>,
}

impl EngineSessionManager {
    pub fn new(
        config: EngineConfig,
        tool_registry: ToolRegistry,
        event_tx: broadcast::Sender<(String, Value)>,
    ) -> Self {
        let agent_loop = Arc::new(AgentLoop::new(config, tool_registry, event_tx));
        Self {
            agent_loop,
            active_sessions: Arc::new(Mutex::new(HashMap::new())),
            turn_counter: Arc::new(std::sync::atomic::AtomicU64::new(1)),
        }
    }

    pub async fn is_running(&self, session_id: &str) -> bool {
        let active = self.active_sessions.lock().await;
        active.contains_key(session_id)
    }

    pub async fn abort(&self, session_id: &str) -> Result<()> {
        let active = self.active_sessions.lock().await;
        if let Some(state) = active.get(session_id) {
            info!("Aborting native engine execution for session {}", session_id);
            state.cancel_token.cancel();
        }
        Ok(())
    }

    pub async fn set_model(&self, session_id: &str, model: &str) {
        let mut active = self.active_sessions.lock().await;
        if let Some(state) = active.get_mut(session_id) {
            state.model = Some(model.to_string());
        }
    }

    pub async fn prompt(
        &self,
        session_id: &str,
        message: &str,
        cwd: &str,
        model_override: Option<&str>,
    ) -> Result<()> {
        let cancel_token = CancellationToken::new();
        let turn_id = self.turn_counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        {
            let mut active = self.active_sessions.lock().await;
            if let Some(existing) = active.get(session_id) {
                existing.cancel_token.cancel();
            }
            active.insert(
                session_id.to_string(),
                ActiveSessionState {
                    cancel_token: cancel_token.clone(),
                    model: model_override.map(|s| s.to_string()),
                    turn_id,
                },
            );
        }

        let loop_runner = self.agent_loop.clone();
        let sid = session_id.to_string();
        let msg = message.to_string();
        let cwd_str = cwd.to_string();
        let m_override = model_override.map(|s| s.to_string());
        let active_map = self.active_sessions.clone();

        tokio::spawn(async move {
            let res = loop_runner.run_turn(
                &sid,
                &msg,
                &cwd_str,
                m_override.as_deref(),
                cancel_token,
            ).await;

            if let Err(e) = res {
                warn!("Native engine error during turn for {}: {}", sid, e);
                let _ = loop_runner.event_tx.send((sid.clone(), serde_json::json!({ "type": "turn_end" })));
                let _ = loop_runner.event_tx.send((sid.clone(), serde_json::json!({ "type": "agent_settled" })));
            }

            let mut active = active_map.lock().await;
            if let Some(current) = active.get(&sid) {
                if current.turn_id == turn_id {
                    active.remove(&sid);
                }
            }
        });

        Ok(())
    }
}
