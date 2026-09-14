use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, Mutex};
use tracing::{info, warn};
use serde_json::Value;
use openpi_proto::{SessionInfo, SessionMode};

pub struct ManagedSession {
    pub info: SessionInfo,
    pub child_stdin: Option<ChildStdin>,
    pub child: Option<Child>,
}

#[derive(Clone)]
pub struct Supervisor {
    sessions: Arc<Mutex<HashMap<String, ManagedSession>>>,
    event_tx: broadcast::Sender<(String, Value)>,
}

impl Supervisor {
    pub fn new() -> Self {
        let (event_tx, _) = broadcast::channel(1024);
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
        }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<(String, Value)> {
        self.event_tx.subscribe()
    }

    pub async fn list_sessions(&self) -> Vec<SessionInfo> {
        let sessions = self.sessions.lock().await;
        sessions.values().map(|s| s.info.clone()).collect()
    }

    pub async fn get_session(&self, id: &str) -> Option<SessionInfo> {
        let sessions = self.sessions.lock().await;
        sessions.get(id).map(|s| s.info.clone())
    }

    pub async fn create_session(
        &self,
        id: String,
        cwd: String,
        mode: SessionMode,
        model: Option<String>,
        name: Option<String>,
    ) -> anyhow::Result<SessionInfo> {
        let now = chrono::Utc::now().to_rfc3339();
        let info = SessionInfo {
            session_id: id.clone(),
            cwd: cwd.clone(),
            mode,
            name,
            model,
            running: false,
            created_at: now.clone(),
            updated_at: now,
        };

        let mut sessions = self.sessions.lock().await;
        sessions.insert(
            id.clone(),
            ManagedSession {
                info: info.clone(),
                child_stdin: None,
                child: None,
            },
        );

        Ok(info)
    }

    pub async fn ensure_process(
        &self,
        session_id: &str,
        pi_cli_path: &str,
    ) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().await;
        let session = match sessions.get_mut(session_id) {
            Some(s) => s,
            None => anyhow::bail!("Session not found: {}", session_id),
        };

        if session.child.is_some() {
            return Ok(());
        }

        info!("Spawning pi subprocess for session {}", session_id);
        let mut cmd = Command::new("node");
        cmd.arg(pi_cli_path)
            .arg("--mode")
            .arg("rpc")
            .current_dir(&session.info.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().expect("child stdin piped");
        let stdout = child.stdout.take().expect("child stdout piped");

        session.child_stdin = Some(stdin);
        session.child = Some(child);
        session.info.running = true;

        let tx = self.event_tx.clone();
        let sid = session_id.to_string();

        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(&line) {
                    Ok(event) => {
                        let _ = tx.send((sid.clone(), event));
                    }
                    Err(e) => {
                        warn!("Failed to parse line from pi session {}: {}", sid, e);
                    }
                }
            }
            info!("Subprocess stdout stream ended for session {}", sid);
        });

        Ok(())
    }

    pub async fn send_rpc(&self, session_id: &str, command: &Value) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().await;
        let session = match sessions.get_mut(session_id) {
            Some(s) => s,
            None => anyhow::bail!("Session not found: {}", session_id),
        };

        let stdin = match &mut session.child_stdin {
            Some(s) => s,
            None => anyhow::bail!("Session {} has no running process", session_id),
        };

        let mut line = serde_json::to_string(command)?;
        line.push('\n');
        stdin.write_all(line.as_bytes()).await?;
        stdin.flush().await?;
        Ok(())
    }

    pub async fn stop_session(&self, session_id: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(session_id) {
            session.child_stdin = None;
            if let Some(mut child) = session.child.take() {
                let _ = child.kill().await;
            }
            session.info.running = false;
        }
        Ok(())
    }
}
