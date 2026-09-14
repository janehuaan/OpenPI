use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, Mutex};
use tracing::{info, warn};
use serde_json::Value;
use openpi_proto::{SessionInfo, SessionMode};

pub fn openpi_dir() -> PathBuf {
    if let Ok(p) = std::env::var("OPENPI_DIR") {
        PathBuf::from(p)
    } else {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".openpi")
    }
}

pub fn instances_path() -> PathBuf {
    openpi_dir().join("instances.json")
}

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
        let mut map = HashMap::new();
        let path = instances_path();
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(records) = serde_json::from_str::<Vec<SessionInfo>>(&content) {
                    for mut r in records {
                        r.running = false;
                        map.insert(
                            r.session_id.clone(),
                            ManagedSession {
                                info: r,
                                child_stdin: None,
                                child: None,
                            },
                        );
                    }
                }
            }
        }

        Self {
            sessions: Arc::new(Mutex::new(map)),
            event_tx,
        }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<(String, Value)> {
        self.event_tx.subscribe()
    }

    pub async fn save_records(&self) {
        let path = instances_path();
        let _ = std::fs::create_dir_all(openpi_dir());
        let sessions = self.sessions.lock().await;
        let mut records: Vec<SessionInfo> = sessions.values().map(|s| s.info.clone()).collect();
        records.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        if let Ok(json) = serde_json::to_string_pretty(&records) {
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(&tmp, &path);
            }
        }
    }

    pub async fn list_sessions(&self) -> Vec<SessionInfo> {
        let sessions = self.sessions.lock().await;
        let mut list: Vec<SessionInfo> = sessions.values().map(|s| s.info.clone()).collect();
        list.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        list
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

        {
            let mut sessions = self.sessions.lock().await;
            sessions.insert(
                id.clone(),
                ManagedSession {
                    info: info.clone(),
                    child_stdin: None,
                    child: None,
                },
            );
        }

        self.save_records().await;
        Ok(info)
    }

    pub async fn delete_session(&self, id: &str) -> anyhow::Result<()> {
        let _ = self.stop_session(id).await;
        {
            let mut sessions = self.sessions.lock().await;
            sessions.remove(id);
        }
        self.save_records().await;
        Ok(())
    }

    pub async fn rename_session(&self, id: &str, name: Option<String>) -> anyhow::Result<()> {
        {
            let mut sessions = self.sessions.lock().await;
            if let Some(s) = sessions.get_mut(id) {
                s.info.name = name;
                s.info.updated_at = chrono::Utc::now().to_rfc3339();
            }
        }
        self.save_records().await;
        Ok(())
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
