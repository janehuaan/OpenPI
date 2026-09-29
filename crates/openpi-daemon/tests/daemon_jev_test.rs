use openpi_daemon::app_ops::handle_app_op;
use openpi_jev::JevCoordinator;
use openpi_proto::{ServerMessage, ServerResponse};
use openpi_scheduler::Scheduler;
use openpi_storage::Storage;
use serde_json::{json, Value};
use std::sync::Arc;

fn extract_data(res: ServerMessage) -> Value {
    match res {
        ServerMessage::Response(ServerResponse::Ok { data, .. }) => data,
        ServerMessage::Response(ServerResponse::Err { error, .. }) => panic!("Unexpected error response: {}", error),
        ServerMessage::Event(_) => panic!("Unexpected event message"),
    }
}

#[tokio::test]
async fn test_daemon_jev_ops() -> anyhow::Result<()> {
    let storage = Storage::in_memory()?;
    let scheduler = Scheduler::new(storage.clone());
    let jev = Arc::new(JevCoordinator::new());
    let memory = Arc::new(openpi_memory::CodebaseMemoryManager::new());

    // 1. Test jev_status
    let status_req = json!({ "name": "jev_status" });
    let res = handle_app_op("1", &status_req, &storage, &scheduler, &jev, &memory).await?;
    let data = extract_data(res);
    assert_eq!(data["engine"], "ModernBERT-base (FP32)");

    // 2. Test jev_route
    let route_req = json!({
        "name": "jev_route",
        "prompt": "帮我写个用户登录页的前端组件和提交接口",
        "has_workspace": true
    });
    let res = handle_app_op("2", &route_req, &storage, &scheduler, &jev, &memory).await?;
    let data = extract_data(res);
    assert_eq!(data["mode"], "code");

    // 3. Test jev_check_command
    let check_req = json!({
        "name": "jev_check_command",
        "command": "rm -rf /"
    });
    let res = handle_app_op("3", &check_req, &storage, &scheduler, &jev, &memory).await?;
    let data = extract_data(res);
    assert_eq!(data["action"], "deny");

    // 4. Test jev_process_output (Token Saver + Secret Leak Masking)
    let output_req = json!({
        "name": "jev_process_output",
        "output": "API Key is sk-proj-1234567890abcdef1234567890 and build succeeded"
    });
    let res = handle_app_op("4", &output_req, &storage, &scheduler, &jev, &memory).await?;
    let data = extract_data(res);
    assert!(data["leak"]["has_leaks"].as_bool().unwrap());
    let sanitized = data["leak"]["sanitized_text"].as_str().unwrap();
    assert!(sanitized.contains("[REDACTED_API_KEY]"));
    assert!(!sanitized.contains("sk-proj-"));

    // 5. Test jev_evaluate_task
    let eval_req = json!({
        "name": "jev_evaluate_task",
        "goal": "重构项目并跑通全部单元测试",
        "command": "cargo test",
        "output": "test result: ok. 12 passed; 0 failed",
        "successes": 1
    });
    let res = handle_app_op("5", &eval_req, &storage, &scheduler, &jev, &memory).await?;
    let data = extract_data(res);
    assert_eq!(data["should_stop"], true);

    // 6. Test Sprint 2: code_index & code_search
    let temp_dir = std::env::temp_dir().join(format!("test_daemon_mem_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    std::fs::create_dir_all(&temp_dir)?;
    let sample_file = temp_dir.join("worker.rs");
    std::fs::write(&sample_file, "pub struct TaskWorker;\npub fn execute_background_job() { println!(\"running\"); }")?;

    let index_req = json!({
        "name": "code_index",
        "cwd": temp_dir.to_string_lossy(),
        "max_files": 100
    });
    let res = handle_app_op("6", &index_req, &storage, &scheduler, &jev, &memory).await?;
    let data = extract_data(res);
    assert_eq!(data["indexed"], true);
    assert_eq!(data["files"], 1);

    let search_req = json!({
        "name": "code_search",
        "cwd": temp_dir.to_string_lossy(),
        "query": "execute background job",
        "limit": 3
    });
    let res = handle_app_op("7", &search_req, &storage, &scheduler, &jev, &memory).await?;
    let data = extract_data(res);
    let hits = data["hits"].as_array().unwrap();
    assert!(!hits.is_empty());
    assert_eq!(hits[0]["file_path"], "worker.rs");

    // 7. Test Sprint 2: get_repo_map
    let repomap_req = json!({
        "name": "get_repo_map",
        "cwd": temp_dir.to_string_lossy(),
        "max_depth": 3,
        "max_chars": 2000
    });
    let res = handle_app_op("8", &repomap_req, &storage, &scheduler, &jev, &memory).await?;
    let data = extract_data(res);
    let repo_map = data["repo_map"].as_str().unwrap();
    assert!(repo_map.contains("worker.rs"));

    let _ = std::fs::remove_dir_all(&temp_dir);

    Ok(())
}
