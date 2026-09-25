use anyhow::{anyhow, Result};
use openpi_proto::{ClientRequest, ServerMessage, ServerResponse};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
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
        if let Ok(w) = std::env::var("OPENPI_WORKSPACE") {
            w
        } else {
            std::env::var("HOME").unwrap_or_else(|_| ".".into())
        }
    })
}

type PendingMap = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;

#[derive(Clone)]
pub struct DaemonClient {
    write_half: Arc<Mutex<Option<OwnedWriteHalf>>>,
    pending: PendingMap,
    event_tx: mpsc::Sender<(String, Value)>,
}

impl DaemonClient {
    pub fn new(event_tx: mpsc::Sender<(String, Value)>) -> Self {
        Self {
            write_half: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
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
            }
        }
        candidates.push(PathBuf::from("/Users/huaan/openpi-next/target/release/openpi-daemon"));
        candidates.push(PathBuf::from("/Users/huaan/openpi-next/dist/OpenPI-Tauri.app/Contents/MacOS/openpi-daemon"));
        candidates.push(PathBuf::from("openpi-daemon"));
        candidates.push(PathBuf::from("../../../target/release/openpi-daemon"));
        candidates.push(PathBuf::from("../../../target/debug/openpi-daemon"));
        candidates.push(PathBuf::from("/usr/local/bin/openpi-daemon"));

        for c in &candidates {
            if c.is_file() && c.exists() {
                if let Ok(_child) = tokio::process::Command::new(c)
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
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
}
