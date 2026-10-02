use anyhow::{bail, Result};
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
}

#[derive(Clone)]
pub struct EngineSessionManager {
    agent_loop: Arc<AgentLoop>,
    active_sessions: Arc<Mutex<HashMap<String, ActiveSessionState>>>,
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
        }
    }

    pub async fn is_running(&self, session_id: &str) -> bool {
        let active = self.active_sessions.lock().await;
        active.contains_key(session_id)
    }

    pub async fn abort(&self, session_id: &str) -> Result<()> {
        let mut active = self.active_sessions.lock().await;
        if let Some(state) = active.remove(session_id) {
            info!("Aborting native engine execution for session {}", session_id);
            state.cancel_token.cancel();
            Ok(())
        } else {
            Ok(())
        }
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

        {
            let mut active = self.active_sessions.lock().await;
            if active.contains_key(session_id) {
                bail!("Session {} is already processing a prompt", session_id);
            }
            active.insert(
                session_id.to_string(),
                ActiveSessionState {
                    cancel_token: cancel_token.clone(),
                    model: model_override.map(|s| s.to_string()),
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
            }

            let mut active = active_map.lock().await;
            active.remove(&sid);
        });

        Ok(())
    }
}
