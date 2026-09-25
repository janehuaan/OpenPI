use tauri::{AppHandle, Manager};
fn test_tray(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id("main") {
        tray.on_menu_event(|app, event| {});
    }
}
