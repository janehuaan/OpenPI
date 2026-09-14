use std::collections::HashSet;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use openpi_proto::{ClientRequest, HealthInfo, ServerMessage};
use crate::supervisor::Supervisor;

pub async fn run_ipc_server(
    socket_path: &str,
    supervisor: Supervisor,
    pi_cli_path: String,
) -> anyhow::Result<()> {
    if std::path::Path::new(socket_path).exists() {
        let _ = std::fs::remove_file(socket_path);
    }
    if let Some(parent) = std::path::Path::new(socket_path).parent() {
        std::fs::create_dir_all(parent)?;
    }

    let listener = UnixListener::bind(socket_path)?;
    info!("OpenPI Rust Daemon listening on {}", socket_path);

    let start_time = std::time::Instant::now();

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let supervisor = supervisor.clone();
                let pi_cli = pi_cli_path.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, supervisor, pi_cli, start_time).await {
                        warn!("Client connection error: {}", e);
                    }
                });
            }
            Err(e) => {
                error!("Failed to accept connection: {}", e);
            }
        }
    }
}

async fn handle_connection(
    stream: UnixStream,
    supervisor: Supervisor,
    pi_cli_path: String,
    start_time: std::time::Instant,
) -> anyhow::Result<()> {
    let (reader_half, mut writer_half) = stream.into_split();
    let reader = BufReader::new(reader_half);
    let mut lines = reader.lines();

    let subscribed_sessions = Arc::new(Mutex::new(HashSet::<String>::new()));
    let subs_clone = subscribed_sessions.clone();

    // Event broadcast forwarder
    let mut event_rx = supervisor.subscribe_events();
    let (event_tx, mut event_rx_forward) = tokio::sync::mpsc::channel::<String>(128);

    tokio::spawn(async move {
        while let Ok((session_id, event)) = event_rx.recv().await {
            let subs = subs_clone.lock().await;
            if subs.contains(&session_id) {
                let msg = ServerMessage::event(&session_id, event);
                if let Ok(line) = msg.to_json_line() {
                    let _ = event_tx.send(line).await;
                }
            }
        }
    });

    let (write_tx, mut write_rx) = tokio::sync::mpsc::channel::<String>(256);
    tokio::spawn(async move {
        while let Some(line) = write_rx.recv().await {
            if let Err(e) = writer_half.write_all(line.as_bytes()).await {
                warn!("Failed to write to client socket: {}", e);
                break;
            }
            let _ = writer_half.flush().await;
        }
    });

    let write_tx_events = write_tx.clone();
    tokio::spawn(async move {
        while let Some(line) = event_rx_forward.recv().await {
            let _ = write_tx_events.send(line).await;
        }
    });

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }

        let request: ClientRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                warn!("Invalid client request JSON: {}", e);
                continue;
            }
        };

        let req_id = request.id().to_string();

        let response = match request {
            ClientRequest::Health { id } => {
                let sessions = supervisor.list_sessions().await;
                let running = sessions.iter().filter(|s| s.running).count();
                let health = HealthInfo {
                    ok: true,
                    pid: std::process::id(),
                    version: env!("CARGO_PKG_VERSION").to_string(),
                    cli_mtime_ms: 0,
                    cli_path: pi_cli_path.clone(),
                    session_count: sessions.len(),
                    running_count: running,
                    uptime_ms: start_time.elapsed().as_millis() as u64,
                };
                ServerMessage::ok(id, serde_json::to_value(health)?)
            }
            ClientRequest::ListSessions { id } => {
                let sessions = supervisor.list_sessions().await;
                ServerMessage::ok(id, serde_json::to_value(sessions)?)
            }
            ClientRequest::CreateSession {
                id,
                cwd,
                mode,
                model,
                name,
            } => {
                let session_id = uuid::Uuid::new_v4().to_string();
                let mode = mode.unwrap_or_default();
                match supervisor
                    .create_session(session_id, cwd, mode, model, name)
                    .await
                {
                    Ok(info) => ServerMessage::ok(id, serde_json::to_value(info)?),
                    Err(e) => ServerMessage::err(id, e.to_string()),
                }
            }
            ClientRequest::Subscribe { id, session_id } => {
                let mut subs = subscribed_sessions.lock().await;
                subs.insert(session_id.clone());
                // Ensure process is running
                if let Err(e) = supervisor.ensure_process(&session_id, &pi_cli_path).await {
                    warn!("Failed to ensure process for {}: {}", session_id, e);
                }
                ServerMessage::ok(id, serde_json::json!({"subscribed": true}))
            }
            ClientRequest::Unsubscribe { id, session_id } => {
                let mut subs = subscribed_sessions.lock().await;
                subs.remove(&session_id);
                ServerMessage::ok(id, serde_json::json!({"unsubscribed": true}))
            }
            ClientRequest::Rpc {
                id,
                session_id,
                command,
            } => {
                let _ = supervisor.ensure_process(&session_id, &pi_cli_path).await;
                match supervisor.send_rpc(&session_id, &command).await {
                    Ok(_) => ServerMessage::ok(id, serde_json::json!({"sent": true})),
                    Err(e) => ServerMessage::err(id, e.to_string()),
                }
            }
            ClientRequest::StopSession { id, session_id } => {
                match supervisor.stop_session(&session_id).await {
                    Ok(_) => ServerMessage::ok(id, serde_json::json!({"stopped": true})),
                    Err(e) => ServerMessage::err(id, e.to_string()),
                }
            }
            ClientRequest::Shutdown { id } => {
                let _ = write_tx.send(ServerMessage::ok(id, serde_json::json!({"shutting_down": true})).to_json_line()?).await;
                std::process::exit(0);
            }
            _other => {
                ServerMessage::ok(req_id, serde_json::json!({"status": "noop_or_unimplemented"}))
            }
        };

        let _ = write_tx.send(response.to_json_line()?).await;
    }

    Ok(())
}
