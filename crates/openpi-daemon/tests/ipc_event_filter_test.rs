use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use openpi_daemon::{run_ipc_server, Supervisor};
use openpi_storage::Storage;
use openpi_scheduler::Scheduler;

#[tokio::test]
async fn test_ipc_system_event_filter_bypass() {
    let temp_dir = std::env::temp_dir();
    let sock_path = temp_dir.join(format!("test-filter-{}.sock", uuid::Uuid::new_v4()));
    let sock_str = sock_path.to_string_lossy().to_string();

    let sock_clone = sock_str.clone();
    let supervisor = Supervisor::new();
    let supervisor_clone = supervisor.clone();

    let daemon_handle = tokio::spawn(async move {
        let storage = Storage::in_memory().unwrap();
        let scheduler = Scheduler::new(storage.clone());
        let cloud = openpi_daemon::CloudSync::new(storage.clone());
        let _ = run_ipc_server(&sock_clone, supervisor_clone, storage, scheduler, "dummy-path".to_string(), cloud).await;
    });

    for _ in 0..50 {
        if sock_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(sock_path.exists(), "Socket file must exist");

    let stream = UnixStream::connect(&sock_str).await.expect("connect to socket");
    let (reader, mut writer) = stream.into_split();
    let mut reader = BufReader::new(reader);

    // Subscribe to a specific session
    let sub_req = serde_json::json!({
        "id": "req-sub-1",
        "type": "subscribe",
        "sessionId": "session-user-123"
    });
    writer.write_all(format!("{}\n", sub_req).as_bytes()).await.unwrap();
    writer.flush().await.unwrap();

    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    let sub_resp: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(sub_resp["id"], "req-sub-1");
    assert_eq!(sub_resp["ok"], true);

    // Emit a system broadcast event: "*"
    let _ = supervisor.event_tx.send(("*".to_string(), serde_json::json!({ "type": "global_notice", "msg": "all" })));

    // Emit a task-scheduler event
    let _ = supervisor.event_tx.send(("task-scheduler".to_string(), serde_json::json!({ "type": "scheduler_tick" })));

    // Emit a proactive event
    let _ = supervisor.event_tx.send(("proactive".to_string(), serde_json::json!({ "type": "action_card", "id": "card-1" })));

    // Collect every broadcast event that arrives within an idle window
    let mut received_sessions = Vec::new();
    loop {
        line.clear();
        match tokio::time::timeout(Duration::from_millis(800), reader.read_line(&mut line)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(_)) => {
                if line.trim().is_empty() {
                    continue;
                }
                let ev: serde_json::Value = serde_json::from_str(&line).unwrap();
                if ev["type"] == "event" {
                    received_sessions.push(ev["sessionId"].as_str().unwrap().to_string());
                }
            }
            _ => break,
        }
    }
    eprintln!("received_sessions = {:?}", received_sessions);

    assert!(received_sessions.contains(&"*".to_string()), "Must receive wildcard event");
    assert!(received_sessions.contains(&"task-scheduler".to_string()), "Must receive task-scheduler event");
    assert!(received_sessions.contains(&"proactive".to_string()), "Must receive proactive event");

    daemon_handle.abort();
    let _ = std::fs::remove_file(&sock_path);
}
