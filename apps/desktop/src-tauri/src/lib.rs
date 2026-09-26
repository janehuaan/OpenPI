pub mod daemon_client;
pub mod ipc_handlers;
pub mod oauth_listener;
pub mod tray;

use daemon_client::DaemonClient;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tracing::info;

#[tauri::command]
async fn openpi_invoke(
    app: AppHandle,
    client: State<'_, DaemonClient>,
    channel: String,
    args: Value,
) -> Result<Value, String> {
    ipc_handlers::handle_invoke(app, (*client).clone(), channel, args).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();
    info!("Starting OpenPI Desktop (Tauri v2 + Rust)");

    let (event_tx, mut event_rx) = mpsc::channel::<(String, Value)>(4096);
    let daemon_client = DaemonClient::new(event_tx);

    tauri::Builder::default()
        .manage(daemon_client.clone())
        .setup(move |app| {
            let handle = app.handle().clone();

            // Start native OAuth HTTP callback listener on 127.0.0.1:5179
            oauth_listener::start_oauth_listener(handle.clone());

            // Set up macOS menu bar system tray
            let _ = tray::create_tray(&handle);

            // Connect to Rust daemon asynchronously
            let client_clone = daemon_client.clone();
            tauri::async_runtime::spawn(async move {
                let _ = client_clone.ensure_connected().await;
            });

            // Forward daemon stream events to frontend Webview
            let handle_events = handle.clone();
            tauri::async_runtime::spawn(async move {
                while let Some((session_id, event)) = event_rx.recv().await {
                    let _ = handle_events.emit("openpi:conversation-event", serde_json::json!({
                        "instanceId": session_id,
                        "event": event
                    }));
                }
            });

            // Ensure main window is unminimized and brought to front
            if let Some(main) = handle.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }

            // Local control channel via ~/.openpi/desktop.cmd
            let handle_cmd = handle.clone();
            tauri::async_runtime::spawn(async move {
                let cmd_file = daemon_client::openpi_dir().join("desktop.cmd");
                loop {
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    if let Ok(content) = std::fs::read_to_string(&cmd_file) {
                        let trimmed = content.trim();
                        if !trimmed.is_empty() {
                            let _ = std::fs::write(&cmd_file, "");
                            let parts: Vec<&str> = trimmed.splitn(2, ' ').collect();
                            match parts[0] {
                                "navigate" => {
                                    if let Some(main) = handle_cmd.get_webview_window("main") {
                                        let _ = main.unminimize();
                                        let _ = main.show();
                                        let _ = main.set_focus();
                                    }
                                    let view = parts.get(1).unwrap_or(&"chat");
                                    let _ = handle_cmd.emit("openpi:navigate", serde_json::json!({ "view": view }));
                                }
                                "focus" | "show" => {
                                    if let Some(main) = handle_cmd.get_webview_window("main") {
                                        let _ = main.unminimize();
                                        let _ = main.show();
                                        let _ = main.set_focus();
                                    }
                                }
                                "select" => {
                                    if let Some(id) = parts.get(1) {
                                        let _ = handle_cmd.emit("openpi:select-conversation", serde_json::json!({ "instanceId": id }));
                                    }
                                }
                                "new" => {
                                    let _ = handle_cmd.emit("openpi:new-conversation", ());
                                }
                                "send" => {
                                    if let Some(text) = parts.get(1) {
                                        let _ = handle_cmd.emit("openpi:send-message", serde_json::json!({ "text": text }));
                                    }
                                }
                                "prefill" => {
                                    if let Some(text) = parts.get(1) {
                                        let _ = handle_cmd.emit("openpi:composer-prefill", serde_json::json!({ "text": text }));
                                    }
                                }
                                "toggle-context" | "context" => {
                                    if let Some(main) = handle_cmd.get_webview_window("main") {
                                        let _ = main.eval("window.dispatchEvent(new CustomEvent('openpi:toggle-context'))");
                                    }
                                }
                                "eval" => {
                                    if let Some(js) = parts.get(1) {
                                        if let Some(main) = handle_cmd.get_webview_window("main") {
                                            let _ = main.eval(*js);
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![openpi_invoke])
        .run(tauri::generate_context!())
        .expect("error while running openpi desktop tauri application");
}
