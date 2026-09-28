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

    // Repetitive read queries (e.g. grep) that succeed also trigger circuit breaker if repeated
    let grep_cmd = "grep -rn \"defrost\" src/";
    let grep_res = "src/view.tsx:10: defrost";
    coordinator.record_command_result("ls -la", true, "src").await; // reset with another command
    let g1 = coordinator.record_command_result(grep_cmd, true, grep_res).await.unwrap();
    assert!(!g1.should_break);
    let g2 = coordinator.record_command_result(grep_cmd, true, grep_res).await.unwrap();
    assert!(g2.should_break);
    assert!(g2.corrective_hint.unwrap().contains("grep"));
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

#[tokio::test]
async fn test_telemetry_and_records() {
    let coordinator = JevCoordinator::new();

    // 1. Pre-check blocked command
    let _ = coordinator.pre_check_command("rm -rf / --no-preserve-root");
    let _ = coordinator.pre_check_command("apt install nginx");
    let _ = coordinator.pre_check_command("git reset --hard HEAD");

    // 2. Loop breaker
    for _ in 0..4 {
        let _ = coordinator.record_command_result("npm run build", false, "error TS2322: Type 'string' is not assignable").await;
    }

    // 3. Leak & compression
    let sample_leak = "sk-proj-abcdef1234567890abcdef1234567890";
    let _ = coordinator.process_command_output(sample_leak);

    let telemetry = coordinator.get_telemetry();
    assert!(telemetry.blocked_commands >= 1);
    assert!(telemetry.auto_patched_commands >= 1);
    assert!(telemetry.user_confirmed_commands >= 1);
    assert!(telemetry.loop_breaks >= 1);
    assert!(telemetry.secrets_redacted >= 1);
    assert!(!telemetry.recent_blocks.is_empty());

    // Verify recent block record contents
    let first = &telemetry.recent_blocks[0];
    assert!(!first.command.is_empty());
    assert!(!first.reason.is_empty());
}

#[test]
fn test_file_path_protection() {
    let coordinator = JevCoordinator::new();

    // 1. Prohibited OS path (/etc/passwd) -> Deny
    let v1 = coordinator.pre_check_file_path("/etc/passwd");
    assert!(matches!(v1, GateVerdict::Deny { .. }));

    // 2. Sensitive SSH private key -> Deny
    let v2 = coordinator.pre_check_file_path("/Users/test/.ssh/id_ed25519");
    assert!(matches!(v2, GateVerdict::Deny { .. }));

    // 3. Sensitive AWS credential -> Deny
    let v3 = coordinator.pre_check_file_path("/home/user/.aws/credentials");
    assert!(matches!(v3, GateVerdict::Deny { .. }));

    // 4. Shell startup profile -> RequireConfirmation
    let v4 = coordinator.pre_check_file_path("/Users/test/.zshrc");
    assert!(matches!(v4, GateVerdict::RequireConfirmation { .. }));

    // 5. Normal project file -> Allow
    let v5 = coordinator.pre_check_file_path("src/components/Button.tsx");
    assert_eq!(v5, GateVerdict::Allow);
}

#[test]
fn test_multi_world_branching_and_scoring() {
    use openpi_jev::dreamer::parser::SessionTreeParser;

    let parser = SessionTreeParser::new();

    // 1. Verify fine-grained scores
    let test_score = parser.estimate_score("test result: ok. 12 passed; 0 failed", false);
    assert!(test_score >= 0.95);

    let build_score = parser.estimate_score("Finished `release` profile [optimized] target(s) in 2.1s", false);
    assert!((build_score - 0.85).abs() < 1e-4);

    let git_score = parser.estimate_score("[main a1b2c3d] fix: resolved compile error\n 1 file changed, 2 insertions(+)", false);
    assert!((git_score - 0.80).abs() < 1e-4);

    let warning_score = parser.estimate_score("warning: unused variable: `x`\n[main a1b2c3d] committed", false);
    assert!(warning_score < git_score);

    let repairable_score = parser.estimate_score("error[E0425]: cannot find value `foo` in this scope", true);
    assert!((repairable_score - 0.20).abs() < 1e-4);

    let hard_score = parser.estimate_score("fatal: not a git repository (or any of the parent directories): .git", true);
    assert_eq!(hard_score, 0.0);

    // 2. Verify multi-world branching DAG
    let records = vec![
        ("cat src/main.rs".into(), "fn main() {}".into(), false), // Step 1: OK (score 0.6) -> baseline
        ("cargo check".into(), "error[E0425]: cannot find value `foo`".into(), true), // Step 2: Failed attempt 1 (score 0.2)
        ("cargo check".into(), "error[E0308]: mismatched types".into(), true), // Step 3: Failed attempt 2 -> Sibling branch!
        ("git commit -m 'fix'".into(), "[main 9876543] fix\n 1 file changed".into(), false), // Step 4: Fixed!
    ];

    let tree = parser.build_from_records("test_task", &records);

    // Step 1 is child of root
    let s1 = tree.nodes.get("test_task_step_1").unwrap();
    assert_eq!(s1.parent_id.as_deref(), Some("test_task"));

    // Step 2 is child of Step 1 on branch 0
    let s2 = tree.nodes.get("test_task_step_2").unwrap();
    assert_eq!(s2.parent_id.as_deref(), Some("test_task_step_1"));
    assert_eq!(s2.branch_id, 0);

    // Step 3 was a retry after Step 2 failed: it branches from Step 1 as a sibling (branch 1)!
    let s3 = tree.nodes.get("test_task_step_3").unwrap();
    assert_eq!(s3.parent_id.as_deref(), Some("test_task_step_1"));
    assert_eq!(s3.branch_id, 1);

    // Step 2, Step 3, and Step 4 are all sibling branches under Step 1 until Step 4 succeeds!
    let children_of_s1 = tree.get_children("test_task_step_1");
    assert_eq!(children_of_s1.len(), 3);

    // Step 4 is child of Step 1 on branch 2
    let s4 = tree.nodes.get("test_task_step_4").unwrap();
    assert_eq!(s4.parent_id.as_deref(), Some("test_task_step_1"));
    assert_eq!(s4.branch_id, 2);
}


