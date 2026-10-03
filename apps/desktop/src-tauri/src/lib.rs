pub mod daemon_client;
pub mod ipc_handlers;
pub mod island_native;
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

                    // Smart Dynamic Island: Auto-show island on user turn start
                    let is_subagent = session_id.starts_with("subagent-");
                    if !is_subagent {
                        if let Some(event_obj) = event.as_object() {
                            if let Some(ev_type) = event_obj.get("type").and_then(|v| v.as_str()) {
                                if ev_type == "agent_start" || ev_type == "turn_start" {
                                    let app_island = handle_events.clone();
                                    let _ = handle_events.run_on_main_thread(move || {
                                        if let Some(island) = app_island.get_webview_window("island") {
                                            if !island.is_visible().unwrap_or(false) {
                                                island_native::position_island_top_center(&island, 360.0, 44.0);
                                                let _ = island.show();
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            });

            // Ensure main window is unminimized and brought to front
            if let Some(main) = handle.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }

            // Configure OpenPI Island window at top-center of screen (starts hidden)
            if let Some(island) = handle.get_webview_window("island") {
                island_native::position_island_top_center(&island, 360.0, 44.0);
                let _ = island.hide();
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
                                "island" => {
                                    let arg = parts.get(1).copied().unwrap_or("");
                                    if arg == "expand" || arg == "open" {
                                        let _ = handle_cmd.emit("openpi:island-state", serde_json::json!({ "expanded": true }));
                                        let app_island = handle_cmd.clone();
                                        let _ = handle_cmd.run_on_main_thread(move || {
                                            if let Some(island) = app_island.get_webview_window("island") {
                                                island_native::position_island_top_center(&island, 560.0, 530.0);
                                                let _ = island.show();
                                                let _ = island.set_focus();
                                            }
                                        });
                                    } else if arg == "collapse" || arg == "close" {
                                        let _ = handle_cmd.emit("openpi:island-state", serde_json::json!({ "expanded": false }));
                                        let app_island = handle_cmd.clone();
                                        let _ = handle_cmd.run_on_main_thread(move || {
                                            if let Some(island) = app_island.get_webview_window("island") {
                                                island_native::position_island_top_center(&island, 360.0, 44.0);
                                                let _ = island.show();
                                            }
                                        });
                                    } else if arg == "hide" {
                                        if let Some(island) = handle_cmd.get_webview_window("island") {
                                            let _ = island.hide();
                                        }
                                    } else if arg == "show" {
                                        let _ = handle_cmd.emit("openpi:island-state", serde_json::json!({ "expanded": false }));
                                        let app_island = handle_cmd.clone();
                                        let _ = handle_cmd.run_on_main_thread(move || {
                                            if let Some(island) = app_island.get_webview_window("island") {
                                                island_native::position_island_top_center(&island, 360.0, 44.0);
                                                let _ = island.show();
                                            }
                                        });
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
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Background residency: Prevent destroying windows on close (red X or Cmd+W).
                // Instead, hide the window so the background agent continues uninterrupted,
                // and the Dynamic Island and tray stay operational.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building openpi desktop tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::Reopen { .. } => {
                    // Clicking Dock icon re-opens and focuses main window
                    if let Some(main) = app_handle.get_webview_window("main") {
                        let _ = main.unminimize();
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
                _ => {}
            }
        });
}
