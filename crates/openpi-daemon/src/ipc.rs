use std::collections::HashSet;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{broadcast, Mutex};
use tracing::{error, info, warn};
use openpi_proto::{ClientRequest, HealthInfo, ServerMessage};
use openpi_scheduler::Scheduler;
use openpi_storage::Storage;
use crate::app_ops::handle_app_op;
use crate::supervisor::Supervisor;

pub async fn run_ipc_server(
    socket_path: &str,
    supervisor: Supervisor,
    storage: Storage,
    scheduler: Scheduler,
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
                let storage = storage.clone();
                let scheduler = scheduler.clone();
                let pi_cli = pi_cli_path.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, supervisor, storage, scheduler, pi_cli, start_time).await {
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
    storage: Storage,
    scheduler: Scheduler,
    pi_cli_path: String,
    start_time: std::time::Instant,
) -> anyhow::Result<()> {
    let (reader_half, mut writer_half) = stream.into_split();
    let reader = BufReader::new(reader_half);
    let mut lines = reader.lines();

    let subscribed_sessions = Arc::new(Mutex::new(HashSet::<String>::new()));
    let subs_clone = subscribed_sessions.clone();

    let (write_tx, mut write_rx) = tokio::sync::mpsc::channel::<String>(2048);
    tokio::spawn(async move {
        while let Some(line) = write_rx.recv().await {
            if let Err(e) = writer_half.write_all(line.as_bytes()).await {
                warn!("Failed to write to client socket: {}", e);
                break;
            }
            let _ = writer_half.flush().await;
        }
    });

    // Event broadcast forwarder directly into write_tx
    let mut event_rx = supervisor.subscribe_events();
    let write_tx_events = write_tx.clone();

    tokio::spawn(async move {
        loop {
            match event_rx.recv().await {
                Ok((session_id, event)) => {
                    let subs = subs_clone.lock().await;
                    if !subs.is_empty()
                        && !subs.contains(&session_id)
                        && !subs.iter().any(|s| session_id.contains(s) || s.contains(&session_id))
                    {
                        continue;
                    }
                    drop(subs);

                    let msg = ServerMessage::event(&session_id, event);
                    if let Ok(line) = msg.to_json_line() {
                        if let Err(_) = write_tx_events.send(line).await {
                            break;
                        }
                    }
                }
                Err(broadcast::error::RecvError::Lagged(missed)) => {
                    warn!("IPC broadcast event stream lagged, dropped {} events", missed);
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
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
                ServerMessage::ok(id, serde_json::json!({ "sessions": sessions }))
            }
            ClientRequest::CreateSession {
                id,
                cwd,
                mode,
                model,
                name,
                in_memory,
            } => {
                let session_id = uuid::Uuid::new_v4().to_string();
                let mode = mode.unwrap_or_default();
                match supervisor
                    .create_session(session_id, cwd, mode, model, name, in_memory)
                    .await
                {
                    Ok(info) => ServerMessage::ok(id, serde_json::to_value(info)?),
                    Err(e) => ServerMessage::err(id, e.to_string()),
                }
            }
            ClientRequest::Subscribe { id, session_id } => {
                let mut subs = subscribed_sessions.lock().await;
                subs.insert(session_id.clone());
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
                if let Err(e) = supervisor.ensure_process(&session_id, &pi_cli_path).await {
                    ServerMessage::err(id, e.to_string())
                } else {
                    match supervisor.send_rpc(&session_id, &command).await {
                        Ok(data) => ServerMessage::ok(id, data),
                        Err(e) => ServerMessage::err(id, e.to_string()),
                    }
                }
            }
            ClientRequest::StopSession { id, session_id } => {
                match supervisor.stop_session(&session_id).await {
                    Ok(_) => ServerMessage::ok(id, serde_json::json!({"stopped": true})),
                    Err(e) => ServerMessage::err(id, e.to_string()),
                }
            }
            ClientRequest::DeleteSession { id, session_id } => {
                match supervisor.delete_session(&session_id).await {
                    Ok(_) => ServerMessage::ok(id, serde_json::json!({"deleted": true})),
                    Err(e) => ServerMessage::err(id, e.to_string()),
                }
            }
            ClientRequest::RenameSession { id, session_id, name } => {
                match supervisor.rename_session(&session_id, Some(name)).await {
                    Ok(_) => ServerMessage::ok(id, serde_json::json!({"renamed": true})),
                    Err(e) => ServerMessage::err(id, e.to_string()),
                }
            }
            ClientRequest::UpdateSessionWorkspace { id, session_id, cwd } => {
                match supervisor.update_session_workspace(&session_id, cwd).await {
                    Ok(_) => ServerMessage::ok(id, serde_json::json!({"updated": true})),
                    Err(e) => ServerMessage::err(id, e.to_string()),
                }
            }
            ClientRequest::App { id, op } => {
                handle_app_op(&id, &op, &storage, &scheduler).await?
            }
            ClientRequest::Shutdown { id } => {
                let _ = write_tx.send(ServerMessage::ok(id, serde_json::json!({"shutting_down": true})).to_json_line()?).await;
                std::process::exit(0);
            }
        };

        let _ = write_tx.send(response.to_json_line()?).await;
    }

    Ok(())
}
