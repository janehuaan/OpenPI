use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tracing::{info, warn};

pub fn start_oauth_listener(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let addr = "127.0.0.1:5179";
        let listener = match TcpListener::bind(addr).await {
            Ok(l) => {
                info!("OAuth callback listener successfully bound on http://{}", addr);
                l
            }
            Err(e) => {
                info!(
                    "OAuth callback listener skipped binding to {} (likely Vite dev server running): {}",
                    addr, e
                );
                return;
            }
        };

        let app = Arc::new(app_handle);

        loop {
            let (mut socket, _) = match listener.accept().await {
                Ok(conn) => conn,
                Err(e) => {
                    warn!("Error accepting OAuth connection: {}", e);
                    continue;
                }
            };

            let app_clone = Arc::clone(&app);

            tokio::spawn(async move {
                let mut buf = [0u8; 16384];
                let n = match socket.read(&mut buf).await {
                    Ok(n) if n > 0 => n,
                    _ => return,
                };

                let request = String::from_utf8_lossy(&buf[..n]);

                if request.starts_with("POST /callback") || request.starts_with("POST /oauth-callback") {
                    // Extract JSON body
                    let body = request.split("\r\n\r\n").nth(1).unwrap_or("");
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(body) {
                        if let Some(hash) = val.get("hash").and_then(|h| h.as_str()) {
                            let _ = app_clone.emit("openpi:oauth-callback", serde_json::json!({ "hash": hash }));
                        }
                    }

                    // Bring main window to front
                    if let Some(main) = app_clone.get_webview_window("main") {
                        let _ = main.unminimize();
                        let _ = main.show();
                        let _ = main.set_focus();
                    }

                    let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n{\"ok\":true}";
                    let _ = socket.write_all(response.as_bytes()).await;
                    let _ = socket.flush().await;
                    return;
                }

                // If GET request, serve OAuth success bridge page
                let html = r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>OpenPI 授权登录成功</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #090d16;
      color: #f1f5f9;
    }
    .card {
      background: #131b2e;
      border: 1px solid #1e293b;
      padding: 36px 44px;
      border-radius: 16px;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
      max-width: 440px;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 10px; color: #38bdf8; }
    p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 18px; }
    .status {
      display: inline-block;
      padding: 6px 14px;
      font-size: 12px;
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border-radius: 20px;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✨</div>
    <h1>授权登录成功</h1>
    <p>凭证已自动同步至 OpenPI 桌面客户端，应用正在自动唤醒中...</p>
    <div class="status" id="status-text">正在回传 Token...</div>
  </div>
  <script>
    const hash = window.location.hash;
    if (hash && hash.includes("access_token=")) {
      fetch("/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash })
      }).then(() => {
        document.getElementById("status-text").textContent = "✅ 已同步，此网页可安全关闭";
        setTimeout(() => {
          try { window.close(); } catch(e) {}
        }, 1500);
      }).catch(err => {
        document.getElementById("status-text").textContent = "同步完成";
      });
    } else {
      document.getElementById("status-text").textContent = "未检测到 Hash Token";
    }
  </script>
</body>
</html>"#;

                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    html.len(),
                    html
                );
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.flush().await;
            });
        }
    });
}
