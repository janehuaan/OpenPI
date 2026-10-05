//! System and Island-window operations for the desktop bridge.
//!
//! Split out of `handle_invoke` for the same reason as `git_ops`: these arms only
//! touch the Tauri `AppHandle` and `island_native`, so they stay self-contained.

use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::process::Command;
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

/// Channels handled by this module.
pub fn is_system_channel(channel: &str) -> bool {
    matches!(channel, "system_get_telemetry" | "system_list_ports" | "system_kill_port" | "system_capture_screen" | "focus_main_window" | "set_island_expanded" | "open_main_from_island" | "toggle_island_window" | "show_island_window" | "hide_island_window" | "set_island_mouse_ignore")
}

pub fn handle(app: &AppHandle, op: &str, args: &Value) -> Result<Value, String> {
    match op {
        "system_get_telemetry" => {
            let mut sys = System::new_all();
            sys.refresh_all();
            let cpu = sys.global_cpu_usage();
            let total_mem = sys.total_memory() / 1024 / 1024;
            let used_mem = sys.used_memory() / 1024 / 1024;
            Ok(json!({
                "cpuUsage": cpu,
                "memoryUsedMb": used_mem,
                "memoryTotalMb": total_mem,
                "uptimeSeconds": System::uptime()
            }))
        }

        "system_list_ports" => {
            let out = Command::new("lsof")
                .args(["-iTCP", "-sTCP:LISTEN", "-P", "-n"])
                .output()
                .map_err(|e| e.to_string())?;

            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let mut ports = Vec::new();
            for line in stdout.lines().skip(1) {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 9 {
                    let cmd = parts[0];
                    let pid = parts[1];
                    let name = parts[8];
                    if let Some(idx) = name.rfind(':') {
                        let port_str = &name[idx+1..];
                        if let Ok(port) = port_str.parse::<u16>() {
                            ports.push(json!({
                                "command": cmd,
                                "pid": pid,
                                "port": port
                            }));
                        }
                    }
                }
            }
            Ok(json!(ports))
        }

        "system_kill_port" => {
            let port = args.get("port").and_then(|v| v.as_u64()).unwrap_or(0);
            if port > 0 {
                let script = format!("kill -9 $(lsof -t -i:{} 2>/dev/null) 2>/dev/null || true", port);
                let _ = Command::new("sh").args(["-c", &script]).output();
            }
            Ok(json!(true))
        }

        "system_capture_screen" => {
            let tmp = format!("/tmp/openpi_cap_{}.png", Uuid::new_v4());
            let _ = Command::new("screencapture").args(["-i", "-r", &tmp]).output();
            if Path::new(&tmp).exists() {
                let bytes = fs::read(&tmp).unwrap_or_default();
                let _ = fs::remove_file(&tmp);
                let b64 = format!("data:image/png;base64,{}", tauri::image::Image::from_bytes(&bytes).map(|_| "captured").unwrap_or(""));
                Ok(json!({ "image": b64 }))
            } else {
                Ok(json!({ "image": null }))
            }
        }

        // ── Window Controls ────────────────────────────────────────────────

        "focus_main_window" => {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
            Ok(json!(true))
        }

        "set_island_expanded" => {
            let expanded = args.get("expanded").and_then(|v| v.as_bool()).unwrap_or(false);
            let mode = args.get("mode").and_then(|v| v.as_str()).map(|s| s.to_string());
            let _ = app.emit("openpi:island-state", serde_json::json!({ "expanded": expanded, "mode": mode }));
            // AppKit NSWindow mutations must happen on the main thread; async IPC
            // handlers run on a tokio worker, so marshal the layout call over.
            let app_island = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(island) = app_island.get_webview_window("island") {
                    let mode_str = mode.as_deref();
                    let is_expanded_state = expanded || mode_str == Some("expanded") || mode_str == Some("attention");
                    let (w, h) = if is_expanded_state {
                        (560.0, 530.0)
                    } else {
                        (360.0, 44.0)
                    };
                    crate::island_native::position_island_top_center(&island, w, h);
                    if is_expanded_state {
                        let _ = island.show();
                        let _ = island.set_focus();
                    }
                }
            });
            Ok(json!(true))
        }

        "open_main_from_island" => {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
            Ok(json!(true))
        }

        "toggle_island_window" => {
            let app_island = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(island) = app_island.get_webview_window("island") {
                    if let Ok(visible) = island.is_visible() {
                        if visible {
                            let _ = island.hide();
                        } else {
                            crate::island_native::position_island_top_center(&island, 360.0, 44.0);
                            let _ = island.show();
                        }
                    }
                }
            });
            Ok(json!(true))
        }

        "show_island_window" => {
            let app_island = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(island) = app_island.get_webview_window("island") {
                    if island.is_visible().unwrap_or(false) {
                        let _ = island.show();
                        return;
                    }
                    let _ = app_island.emit("openpi:island-state", serde_json::json!({ "expanded": false, "mode": "idle" }));
                    crate::island_native::position_island_top_center(&island, 360.0, 44.0);
                    let _ = island.show();
                }
            });
            Ok(json!(true))
        }

        "hide_island_window" => {
            if let Some(island) = app.get_webview_window("island") {
                let _ = island.hide();
            }
            Ok(json!(true))
        }

        "set_island_mouse_ignore" => {
            let ignore = args.get("ignore").and_then(|v| v.as_bool()).unwrap_or(false);
            let app_island = app.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(island) = app_island.get_webview_window("island") {
                    crate::island_native::set_island_mouse_ignore(&island, ignore);
                }
            });
            Ok(json!(true))
        }
        other => Err(format!("unhandled system op: {}", other)),
    }
}
