use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use openpi_daemon::{run_ipc_server, Supervisor};

#[tokio::test]
async fn test_daemon_socket_lifecycle() {
    let temp_dir = std::env::temp_dir();
    let sock_path = temp_dir.join(format!("test-openpi-{}.sock", uuid::Uuid::new_v4()));
    let sock_str = sock_path.to_string_lossy().to_string();

    let sock_clone = sock_str.clone();
    // Spawn daemon in background task
    let daemon_handle = tokio::spawn(async move {
        let supervisor = Supervisor::new();
        let _ = run_ipc_server(&sock_clone, supervisor, "dummy-pi-path".to_string()).await;
    });

    // Wait for socket to become available
    for _ in 0..50 {
        if sock_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(sock_path.exists(), "Socket file must exist");

    // Connect as client
    let stream = UnixStream::connect(&sock_str).await.expect("connect to socket");
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);

    // 1. Test health check
    let req = serde_json::json!({"id": "req-h1", "type": "health"});
    writer.write_all(format!("{}\n", req).as_bytes()).await.unwrap();
    writer.flush().await.unwrap();

    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    let resp: serde_json::Value = serde_json::from_str(&line).expect("parse json response");
    assert_eq!(resp["id"], "req-h1");
    assert_eq!(resp["ok"], true);
    assert_eq!(resp["data"]["ok"], true);

    // 2. Test create_session
    let create_req = serde_json::json!({
        "id": "req-c1",
        "type": "create_session",
        "cwd": "/tmp",
        "name": "Test Session"
    });
    writer.write_all(format!("{}\n", create_req).as_bytes()).await.unwrap();
    writer.flush().await.unwrap();

    line.clear();
    reader.read_line(&mut line).await.unwrap();
    let resp: serde_json::Value = serde_json::from_str(&line).expect("parse create_session response");
    assert_eq!(resp["id"], "req-c1");
    assert_eq!(resp["ok"], true);
    assert_eq!(resp["data"]["name"], "Test Session");
    let session_id = resp["data"]["sessionId"].as_str().unwrap().to_string();

    // 3. Test list_sessions
    let list_req = serde_json::json!({"id": "req-l1", "type": "list_sessions"});
    writer.write_all(format!("{}\n", list_req).as_bytes()).await.unwrap();
    writer.flush().await.unwrap();

    line.clear();
    reader.read_line(&mut line).await.unwrap();
    let resp: serde_json::Value = serde_json::from_str(&line).expect("parse list_sessions response");
    assert_eq!(resp["id"], "req-l1");
    assert_eq!(resp["ok"], true);
    let sessions = resp["data"].as_array().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0]["sessionId"], session_id);

    // Clean up
    daemon_handle.abort();
    let _ = std::fs::remove_file(sock_path);
}
