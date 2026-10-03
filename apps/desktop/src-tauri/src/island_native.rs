//! macOS Native Dynamic Island Window Management
//! Provides deep integration with Cocoa NSWindow/NSPanel, NSScreen, Spaces and WindowServer.

#[cfg(target_os = "macos")]
use objc2_app_kit::{NSColor, NSWindow, NSWindowCollectionBehavior};

/// Configures the Island window to sit directly atop the macOS menu bar / status bar (Level 25)
/// and join all desktop Spaces as a full-screen auxiliary floating panel.
pub fn configure_island_native<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        if let Ok(ptr) = window.ns_window() {
            unsafe {
                let ns_win = &*(ptr as *mut NSWindow);

                // 1. Level: Status Bar Level (25) + 1 to float directly on top of the menu bar
                ns_win.setLevel(26);

                // 2. Spaces: Join all spaces, stay stationary, and survive full-screen apps
                let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::FullScreenAuxiliary
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::IgnoresCycle;
                ns_win.setCollectionBehavior(behavior);

                // 3. True transparency without OS-level window borders or shadows
                ns_win.setOpaque(false);
                ns_win.setHasShadow(false);
                ns_win.setBackgroundColor(Some(&NSColor::clearColor()));

                // 4. Order front regardless of current active application
                ns_win.orderFrontRegardless();
            }
        }
    }
}

/// Dynamically toggles mouse event transparency for the island window.
/// In collapsed pill mode, clicks can pass through to the menu bar beneath if desired.
pub fn set_island_mouse_ignore<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, ignore: bool) {
    #[cfg(target_os = "macos")]
    {
        if let Ok(ptr) = window.ns_window() {
            unsafe {
                let ns_win = &*(ptr as *mut NSWindow);
                ns_win.setIgnoresMouseEvents(ignore);
            }
        }
    }
}

/// Ensures the island window is positioned exactly at the top-center edge of the screen,
/// taking into account the monitor's scale factor and physical dimensions.
pub fn position_island_top_center<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>, width: f64, height: f64) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let screen_w = monitor.size().width as f64 / scale;
        let x = (screen_w - width) / 2.0;
        let y = 0.0;
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
        let _ = window.set_position(tauri::LogicalPosition::new(x, y));
    }
    configure_island_native(window);
}
