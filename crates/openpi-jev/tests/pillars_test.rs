use openpi_jev::coordinator::JevCoordinator;
use openpi_jev::types::{AppMode, GateVerdict, ModelTier};

#[test]
fn test_pillar1_router() {
    let coordinator = JevCoordinator::new();

    // Pure Chat
    let r1 = coordinator.route_prompt("你好，请介绍一下 Rust 语言的生命周期机制", false);
    assert_eq!(r1.mode, AppMode::Chat);
    assert_eq!(r1.recommended_tier, ModelTier::Fast);

    // Code editing
    let r2 = coordinator.route_prompt("帮我把这个页面的按钮样式改一下，再写个接口", true);
    assert_eq!(r2.mode, AppMode::Code);

    // Heavy refactoring
    let r3 = coordinator.route_prompt("请帮我进行全栈重构，把 Electron 迁移到 Tauri 并重写架构", true);
    assert_eq!(r3.mode, AppMode::Code);
    assert_eq!(r3.recommended_tier, ModelTier::Max);
}

#[test]
fn test_pillar2_gatekeeper() {
    let coordinator = JevCoordinator::new();

    // High danger rm -rf / -> Denied
    let v1 = coordinator.pre_check_command("rm -rf /");
    assert!(matches!(v1, GateVerdict::Deny { .. }));

    // git reset --hard -> Require confirmation
    let v2 = coordinator.pre_check_command("git reset --hard HEAD");
    assert!(matches!(v2, GateVerdict::RequireConfirmation { .. }));

    // Interactive apt install without -y -> ModifyCommand
    let v3 = coordinator.pre_check_command("apt install git");
    match v3 {
        GateVerdict::ModifyCommand { safe_command, .. } => {
            assert_eq!(safe_command, "apt install git -y");
        }
        _ => panic!("Expected ModifyCommand for apt install"),
    }

    // Harmless cargo test -> Allow
    let v4 = coordinator.pre_check_command("cargo test");
    assert_eq!(v4, GateVerdict::Allow);
}

#[test]
fn test_pillar3_compressor() {
    let coordinator = JevCoordinator::new();

    // Short output: no compression
    let short_log = "Running tests...\ntest result: ok. 5 passed";
    let (comp, _) = coordinator.process_command_output(short_log);
    assert!(!comp.was_compressed);
    assert_eq!(comp.content, short_log);

    // Massive output (300 lines) with error in middle
    let mut large_log = String::new();
    for i in 0..100 {
        large_log.push_str(&format!("Compiling package_{} v0.1.0\n", i));
    }
    large_log.push_str("Error: could not find symbol 'JevCoordinator' in crate openpi_jev\n");
    large_log.push_str("   --> src/main.rs:12:5\n");
    for i in 101..300 {
        large_log.push_str(&format!("Building intermediate artifact_{}\n", i));
    }

    let (comp2, _) = coordinator.process_command_output(&large_log);
    assert!(comp2.was_compressed);
    assert!(comp2.lines_truncated > 100);
    assert!(comp2.estimated_tokens_saved > 500);
    // Crucial error preserved!
    assert!(comp2.content.contains("could not find symbol 'JevCoordinator'"));
}

#[tokio::test]
async fn test_pillar4_loop_breaker() {
    let coordinator = JevCoordinator::new();

    let cmd = "cargo build --bin non_existent";
    let err = "error: no bin target named `non_existent`\nerror: could not compile";

    // 1st failure: recorded, no break
    let a1 = coordinator.record_command_result(cmd, false, err).await.unwrap();
    assert!(!a1.should_break);

    // 2nd identical failure: circuit breaker triggers!
    let a2 = coordinator.record_command_result(cmd, false, err).await.unwrap();
    assert!(a2.should_break);
    assert!(a2.corrective_hint.is_some());

    // Success resets loop
    coordinator.record_command_result("cargo build", true, "Finished").await;
    let a3 = coordinator.record_command_result(cmd, false, err).await.unwrap();
    assert!(!a3.should_break);
}

#[test]
fn test_pillar5_leak_hunter() {
    let coordinator = JevCoordinator::new();

    let raw_text = "Logging in with key sk-proj-1234567890abcdef1234567890 and token ghp_111122223333444455556666777788889999 to AWS AKIAIOSFODNN7EXAMPLE";
    let (_, leak) = coordinator.process_command_output(raw_text);

    assert!(leak.has_leaks);
    assert_eq!(leak.leak_count, 3);
    assert!(!leak.sanitized_text.contains("sk-proj-"));
    assert!(!leak.sanitized_text.contains("ghp_"));
    assert!(!leak.sanitized_text.contains("AKIAIOSFODNN7EXAMPLE"));
    assert!(leak.sanitized_text.contains("[REDACTED_API_KEY]"));
    assert!(leak.sanitized_text.contains("[REDACTED_GITHUB_TOKEN]"));
    assert!(leak.sanitized_text.contains("[REDACTED_AWS_KEY]"));
}

#[test]
fn test_pillar6_stop_decider() {
    let coordinator = JevCoordinator::new();

    let goal = "修复登录页面构建报错并跑通单测";
    let cmd = "cargo test -p auth";
    let output = "running 8 tests\ntest result: ok. 8 passed; 0 failed";

    let verdict = coordinator.evaluate_task_completion(goal, cmd, output, 1);
    assert!(verdict.should_stop);
    assert!(verdict.confidence >= 0.9);
}
