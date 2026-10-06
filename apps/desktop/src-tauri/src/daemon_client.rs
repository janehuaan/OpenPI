use anyhow::{anyhow, Result};
use openpi_proto::{ClientRequest, ServerMessage, ServerResponse};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::unix::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::{error, info, warn};

pub fn openpi_dir() -> PathBuf {
    if let Ok(p) = std::env::var("OPENPI_DIR") {
        PathBuf::from(p)
    } else {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
        PathBuf::from(home).join(".openpi")
    }
}

pub fn socket_path() -> PathBuf {
    if let Ok(p) = std::env::var("OPENPI_SOCKET_PATH") {
        PathBuf::from(p)
    } else {
        openpi_dir().join("openpi.sock")
    }
}

pub fn sessions_dir() -> PathBuf {
    openpi_dir().join("sessions")
}

pub fn agent_dir() -> PathBuf {
    openpi_dir().join("agent")
}

pub fn find_session_file(sid: &str) -> PathBuf {
    let direct = sessions_dir().join(format!("{}.jsonl", sid));
    if direct.exists() {
        return direct;
    }
    let agent_sessions = agent_dir().join("sessions");
    if agent_sessions.exists() {
        if let Ok(entries) = std::fs::read_dir(&agent_sessions) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    if let Ok(files) = std::fs::read_dir(&p) {
                        for f in files.flatten() {
                            let fp = f.path();
                            if let Some(name) = fp.file_name().and_then(|n| n.to_str()) {
                                if name.contains(sid) && name.ends_with(".jsonl") {
                                    return fp;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    direct
}

static DEFAULT_WS: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn default_workspace() -> &'static str {
    DEFAULT_WS.get_or_init(|| {
        openpi_engine::config::default_project_workspace().to_string_lossy().to_string()
    })
}

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;

/// How long the supervisor waits between checks once it has nothing to do.
const SUPERVISOR_TICK: Duration = Duration::from_secs(2);

/// Whether the supervisor should bring the daemon up right now.
///
/// Split out so the rule is pinned by a test: an explicit `stop_daemon` must
/// always win over the supervisor's eagerness.
fn should_restart(desired_running: bool, connected: bool) -> bool {
    desired_running && !connected
}

#[derive(Clone)]
pub struct DaemonClient {
    write_half: Arc<Mutex<Option<OwnedWriteHalf>>>,
    pending: PendingMap,
    event_tx: mpsc::Sender<(String, Value)>,
    /// Cleared by `stop_daemon`, so a deliberate stop is not undone below.
    desired_running: Arc<AtomicBool>,
}

impl DaemonClient {
    pub fn new(event_tx: mpsc::Sender<(String, Value)>) -> Self {
        Self {
            write_half: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
            desired_running: Arc::new(AtomicBool::new(true)),
        }
    }

    /// Records whether the daemon is supposed to be running.
    pub fn set_desired_running(&self, desired: bool) {
        self.desired_running.store(desired, Ordering::SeqCst);
    }

    pub async fn is_connected(&self) -> bool {
        self.write_half.lock().await.is_some()
    }

    /// Keep the daemon alive for as long as the app is.
    ///
    /// Every high-frequency path is passive — the UI polls `get_snapshot`, which
    /// goes through `request_passive` and deliberately refuses to start a daemon
    /// — and startup connected exactly once. So nothing ever brought one back:
    /// after `install-daemon.sh` replaced the binary the app sat with no daemon
    /// until some active request happened along, and while it was down so were
    /// scheduled tasks and cloud sync.
    pub fn spawn_supervisor(&self) {
        let client = self.clone();
        tauri::async_runtime::spawn(async move {
            client.supervise().await;
        });
    }

    async fn supervise(&self) {
        loop {
            if should_restart(
                self.desired_running.load(Ordering::SeqCst),
                self.is_connected().await,
            ) {
                match self.ensure_connected().await {
                    Ok(()) => info!("Daemon supervisor: daemon is up"),
                    Err(e) => warn!("Daemon supervisor: could not start the daemon: {e}"),
                }
            }
            tokio::time::sleep(SUPERVISOR_TICK).await;
        }
    }

    pub async fn ensure_connected(&self) -> Result<()> {
        let mut lock = self.write_half.lock().await;
        if lock.is_some() {
            return Ok(());
        }

        let sock = socket_path();

        // 1. Try connecting if socket exists
        let mut stream_opt = None;
        if sock.exists() {
            if let Ok(stream) = UnixStream::connect(&sock).await {
                stream_opt = Some(stream);
            }
        }

        // 2. If not connected, clean up stale socket and spawn daemon
        if stream_opt.is_none() {
            if sock.exists() {
                let _ = std::fs::remove_file(&sock);
            }
            Self::try_spawn_daemon().await;

            for _ in 0..25 {
                tokio::time::sleep(Duration::from_millis(200)).await;
                if let Ok(stream) = UnixStream::connect(&sock).await {
                    stream_opt = Some(stream);
                    break;
                }
            }
        }

        let stream = stream_opt.ok_or_else(|| anyhow!("Failed to connect to openpi-daemon at {:?}", sock))?;
        info!("Connected to OpenPI Daemon Unix Socket: {:?}", sock);

        let (read_half, write) = stream.into_split();
        *lock = Some(write);

        let pending = self.pending.clone();
        let event_tx = self.event_tx.clone();
        let write_slot = self.write_half.clone();

        tauri::async_runtime::spawn(async move {
            Self::reader_loop(read_half, pending, event_tx, write_slot).await;
        });

        Ok(())
    }

    async fn try_spawn_daemon() {
        info!("Attempting to spawn openpi-daemon...");
        let mut candidates = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                candidates.push(parent.join("openpi-daemon"));
                candidates.push(parent.join("../Resources/openpi/bin/openpi-daemon"));
            }
        }
        candidates.push(PathBuf::from("/Applications/OpenPI.app/Contents/Resources/openpi/bin/openpi-daemon"));
        candidates.push(PathBuf::from("/Users/huaan/openpi-next/target/release/openpi-daemon"));
        candidates.push(PathBuf::from("/Users/huaan/openpi-next/dist/OpenPI-Tauri.app/Contents/MacOS/openpi-daemon"));
        candidates.push(PathBuf::from("openpi-daemon"));
        candidates.push(PathBuf::from("../../../target/release/openpi-daemon"));
        candidates.push(PathBuf::from("../../../target/debug/openpi-daemon"));
        candidates.push(PathBuf::from("/usr/local/bin/openpi-daemon"));

        for c in &candidates {
            if c.is_file() && c.exists() {
                let log_file = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(openpi_dir().join("daemon.log"))
                    .map(std::process::Stdio::from)
                    .unwrap_or_else(|_| std::process::Stdio::null());

                let err_file = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(openpi_dir().join("daemon.err.log"))
                    .map(std::process::Stdio::from)
                    .unwrap_or_else(|_| std::process::Stdio::null());

                if let Ok(_child) = tokio::process::Command::new(c)
                    .stdin(std::process::Stdio::null())
                    .stdout(log_file)
                    .stderr(err_file)
                    .spawn()
                {
                    info!("Spawned daemon process from {:?}", c);
                    let _ = tokio::time::sleep(Duration::from_millis(500)).await;
                    return;
                }
            }
        }
    }

    async fn reader_loop(
        read_half: OwnedReadHalf,
        pending: PendingMap,
        event_tx: mpsc::Sender<(String, Value)>,
        write_slot: Arc<Mutex<Option<OwnedWriteHalf>>>,
    ) {
        let mut reader = BufReader::new(read_half);
        let mut line = String::new();

        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) => {
                    warn!("Daemon connection closed (EOF)");
                    break;
                }
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    match serde_json::from_str::<ServerMessage>(trimmed) {
                        Ok(msg) => match msg {
                            ServerMessage::Response(resp) => match resp {
                                ServerResponse::Ok { id, data, .. } => {
                                    let mut p = pending.lock().await;
                                    if let Some(tx) = p.remove(&id) {
                                        let _ = tx.send(Ok(data));
                                    }
                                }
                                ServerResponse::Err { id, error, .. } => {
                                    let mut p = pending.lock().await;
                                    if let Some(tx) = p.remove(&id) {
                                        let _ = tx.send(Err(error));
                                    }
                                }
                            },
                            ServerMessage::Event(evt) => {
                                let _ = event_tx.send((evt.session_id, evt.event)).await;
                            }
                        },
                        Err(e) => {
                            warn!("Failed to parse line from daemon: {} | err: {}", trimmed, e);
                        }
                    }
                }
                Err(e) => {
                    error!("Error reading line from daemon socket: {}", e);
                    break;
                }
            }
        }

        // Clean up on disconnect
        let mut lock = write_slot.lock().await;
        *lock = None;
        let mut p = pending.lock().await;
        for (_, tx) in p.drain() {
            let _ = tx.send(Err("Daemon disconnected".to_string()));
        }
    }

    pub async fn request(&self, req: ClientRequest) -> Result<Value, String> {
        let id = req.id().to_string();
        self.ensure_connected()
            .await
            .map_err(|e| format!("Daemon connection error: {}", e))?;

        let (tx, rx) = oneshot::channel();
        {
            let mut p = self.pending.lock().await;
            p.insert(id.clone(), tx);
        }

        let mut json = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        json.push('\n');

        {
            let mut lock = self.write_half.lock().await;
            if let Some(w) = lock.as_mut() {
                if let Err(e) = w.write_all(json.as_bytes()).await {
                    let mut p = self.pending.lock().await;
                    p.remove(&id);
                    return Err(format!("Socket write error: {}", e));
                }
                let _ = w.flush().await;
            } else {
                let mut p = self.pending.lock().await;
                p.remove(&id);
                return Err("Daemon write stream unavailable".to_string());
            }
        }

        match tokio::time::timeout(Duration::from_secs(60), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("Response channel canceled".to_string()),
            Err(_) => {
                let mut p = self.pending.lock().await;
                p.remove(&id);
                Err("Request to daemon timed out".to_string())
            }
        }
    }

    pub async fn try_connect_passive(&self) -> Result<()> {
        let mut lock = self.write_half.lock().await;
        if lock.is_some() {
            return Ok(());
        }

        let sock = socket_path();
        if !sock.exists() {
            return Err(anyhow!("Daemon socket does not exist (daemon sleeping)"));
        }

        if let Ok(stream) = UnixStream::connect(&sock).await {
            let (read_half, write) = stream.into_split();
            *lock = Some(write);

            let pending = self.pending.clone();
            let event_tx = self.event_tx.clone();
            let write_slot = self.write_half.clone();

            tauri::async_runtime::spawn(async move {
                Self::reader_loop(read_half, pending, event_tx, write_slot).await;
            });

            Ok(())
        } else {
            Err(anyhow!("Daemon socket not responding (daemon sleeping)"))
        }
    }

    pub async fn request_passive(&self, req: ClientRequest) -> Result<Value, String> {
        let id = req.id().to_string();
        self.try_connect_passive()
            .await
            .map_err(|e| format!("Daemon not running: {}", e))?;

        let (tx, rx) = oneshot::channel();
        {
            let mut p = self.pending.lock().await;
            p.insert(id.clone(), tx);
        }

        let mut json = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        json.push('\n');

        {
            let mut lock = self.write_half.lock().await;
            if let Some(w) = lock.as_mut() {
                if let Err(e) = w.write_all(json.as_bytes()).await {
                    let mut p = self.pending.lock().await;
                    p.remove(&id);
                    return Err(format!("Socket write error: {}", e));
                }
                let _ = w.flush().await;
            } else {
                let mut p = self.pending.lock().await;
                p.remove(&id);
                return Err("Daemon write stream unavailable".to_string());
            }
        }

        match tokio::time::timeout(Duration::from_secs(5), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => Err("Response channel canceled".to_string()),
            Err(_) => {
                let mut p = self.pending.lock().await;
                p.remove(&id);
                Err("Passive request timed out".to_string())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supervisor_restarts_a_missing_daemon_but_respects_a_deliberate_stop() {
        assert!(should_restart(true, false), "a missing daemon must be brought back");
        assert!(!should_restart(true, true), "a healthy daemon needs no action");
        assert!(
            !should_restart(false, false),
            "an explicit stop_daemon must not be undone by the supervisor"
        );
    }

    /// The rule above is only useful if the loop actually honours it. `stop_daemon`
    /// must leave the daemon down, so the supervisor has to sit still rather than
    /// start one behind the user's back.
    #[tokio::test]
    async fn supervisor_leaves_a_deliberately_stopped_daemon_alone() {
        let (tx, _rx) = mpsc::channel(8);
        let client = DaemonClient::new(tx);
        client.set_desired_running(false);

        let supervisor = tokio::spawn({
            let client = client.clone();
            async move { client.supervise().await }
        });

        tokio::time::sleep(Duration::from_millis(250)).await;
        assert!(
            !client.is_connected().await,
            "the supervisor started a daemon even though it was deliberately stopped"
        );
        supervisor.abort();
    }
}
