use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use openpi_daemon::{run_ipc_server, Supervisor};
use openpi_storage::Storage;
use openpi_scheduler::Scheduler;

#[tokio::test]
async fn test_daemon_full_lifecycle() {
    let temp_dir = std::env::temp_dir();
    let test_openpi_dir = temp_dir.join(format!("test-openpi-dir-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&test_openpi_dir).unwrap();
    std::env::set_var("OPENPI_DIR", test_openpi_dir.to_string_lossy().to_string());

    let sock_path = temp_dir.join(format!("test-openpi-{}.sock", uuid::Uuid::new_v4()));
    let sock_str = sock_path.to_string_lossy().to_string();

    let sock_clone = sock_str.clone();
    // Spawn daemon with in-memory storage & scheduler
    let daemon_handle = tokio::spawn(async move {
        let storage = Storage::in_memory().unwrap();
        let scheduler = Scheduler::new(storage.clone());
        let supervisor = Supervisor::new();
        let _ = run_ipc_server(&sock_clone, supervisor, storage, scheduler, "dummy-pi-path".to_string()).await;
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
        "name": "Rust Test Session"
    });
    writer.write_all(format!("{}\n", create_req).as_bytes()).await.unwrap();
    writer.flush().await.unwrap();

    line.clear();
    reader.read_line(&mut line).await.unwrap();
    let resp: serde_json::Value = serde_json::from_str(&line).expect("parse create_session response");
    assert_eq!(resp["id"], "req-c1");
    let session_id = resp["data"]["sessionId"].as_str().unwrap().to_string();

    // 2b. Test list_sessions
    let list_req = serde_json::json!({
        "id": "req-ls1",
        "type": "list_sessions"
    });
    writer.write_all(format!("{}\n", list_req).as_bytes()).await.unwrap();
    writer.flush().await.unwrap();

    line.clear();
    reader.read_line(&mut line).await.unwrap();
    let resp: serde_json::Value = serde_json::from_str(&line).expect("parse list_sessions response");
    assert_eq!(resp["id"], "req-ls1");
    assert_eq!(resp["ok"], true);
    let session_list = resp["data"]["sessions"].as_array().unwrap();
    assert_eq!(session_list.len(), 1);
    assert_eq!(session_list[0]["sessionId"], session_id);

    // 3. Test AppOp: create_task
    let task_req = serde_json::json!({
        "id": "req-task1",
        "type": "app",
        "op": {
            "name": "create_task",
            "input": {
                "title": "Scheduled Build",
                "prompt": "cargo build --release",
                "cwd": "/tmp",
                "schedule": {
                    "kind": "cron",
                    "expression": "0 0 * * *"
                }
            }
        }
    });
    writer.write_all(format!("{}\n", task_req).as_bytes()).await.unwrap();
    writer.flush().await.unwrap();

    line.clear();
    reader.read_line(&mut line).await.unwrap();
    let resp: serde_json::Value = serde_json::from_str(&line).expect("parse task response");
    assert_eq!(resp["id"], "req-task1");
    assert_eq!(resp["ok"], true);
    assert!(resp["data"]["taskId"].is_string());

    // 4. Test AppOp: list_tasks
    let list_tasks_req = serde_json::json!({
        "id": "req-task2",
        "type": "app",
        "op": { "name": "list_tasks" }
    });
    writer.write_all(format!("{}\n", list_tasks_req).as_bytes()).await.unwrap();
    writer.flush().await.unwrap();

    line.clear();
    reader.read_line(&mut line).await.unwrap();
    let resp: serde_json::Value = serde_json::from_str(&line).expect("parse list_tasks response");
    assert_eq!(resp["id"], "req-task2");
    assert_eq!(resp["ok"], true);
    let tasks = resp["data"]["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    assert_eq!(tasks[0]["task"]["title"], "Scheduled Build");

    // 5. Test AppOp: write_memory & list_memory
    let write_mem_req = serde_json::json!({
        "id": "req-m1",
        "type": "app",
        "op": {
            "name": "write_memory",
            "cwd": "/tmp",
            "scope": "project",
            "type": "architecture",
            "key": "backend",
            "value": "pure-rust"
        }
    });
    writer.write_all(format!("{}\n", write_mem_req).as_bytes()).await.unwrap();
    writer.flush().await.unwrap();

    line.clear();
    reader.read_line(&mut line).await.unwrap();
    let resp: serde_json::Value = serde_json::from_str(&line).expect("parse write_memory response");
    assert_eq!(resp["id"], "req-m1");
    assert_eq!(resp["ok"], true);
    assert!(resp["data"]["entries"].is_array());

    let list_mem_req = serde_json::json!({
        "id": "req-m2",
        "type": "app",
        "op": {
            "name": "list_memory",
            "cwd": "/tmp"
        }
    });
    writer.write_all(format!("{}\n", list_mem_req).as_bytes()).await.unwrap();
    writer.flush().await.unwrap();

    line.clear();
    reader.read_line(&mut line).await.unwrap();
    let resp: serde_json::Value = serde_json::from_str(&line).expect("parse list_memory response");
    assert_eq!(resp["id"], "req-m2");
    assert_eq!(resp["ok"], true);
    let memories = resp["data"]["entries"].as_array().unwrap();
    assert_eq!(memories.len(), 1);
    assert_eq!(memories[0]["value"], "pure-rust");

    // Clean up
    daemon_handle.abort();
    let _ = std::fs::remove_file(sock_path);
}
