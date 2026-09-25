use tauri::menu::{Menu, MenuItem};

use tauri::{AppHandle, Emitter, Manager, Runtime};

pub fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let open_main = MenuItem::with_id(app, "open_main", "打开主界面", true, None::<&str>)?;
    let new_conv = MenuItem::with_id(app, "new_conv", "新建会话 (⌘N)", true, None::<&str>)?;
    let open_git = MenuItem::with_id(app, "open_git", "版本管理 (Git)", true, None::<&str>)?;
    let open_memory = MenuItem::with_id(app, "open_memory", "长期记忆 (Memory)", true, None::<&str>)?;
    let open_tasks = MenuItem::with_id(app, "open_tasks", "定时任务 (Tasks)", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 OpenPI", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_main,
            &new_conv,
            &open_git,
            &open_memory,
            &open_tasks,
            &quit,
        ],
    )?;

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_menu(Some(menu));
        let _ = tray.set_show_menu_on_left_click(true);
        tray.on_menu_event(move |app, event| {
            match event.id.as_ref() {
                "open_main" => {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                }
                "new_conv" => {
                    let _ = app.emit("openpi:new-conversation", ());
                }
                "open_git" => {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                    let _ = app.emit("openpi:navigate", serde_json::json!({ "view": "git" }));
                }
                "open_memory" => {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                    let _ = app.emit("openpi:navigate", serde_json::json!({ "view": "memory" }));
                }
                "open_tasks" => {
                    if let Some(main) = app.get_webview_window("main") {
                        let _ = main.show();
                        let _ = main.set_focus();
                    }
                    let _ = app.emit("openpi:navigate", serde_json::json!({ "view": "tasks" }));
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        });
    }

    Ok(())
}
