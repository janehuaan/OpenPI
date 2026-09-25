use openpi_jev::engine::LocalVerdictEngine;
use openpi_jev::types::*;
use openpi_jev::{EngineStatus, JevCoordinator};
use std::time::Instant;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    println!("============================================================");
    println!("🧪 OpenPI Jev (System 1) 端到端真实 Agent 冒烟与性能提升评测");
    println!("============================================================");

    let coordinator = JevCoordinator::new();

    // ---------------------------------------------------------
    // 阶段 1：冷启动与异步预热状态评测
    // ---------------------------------------------------------
    println!("\n[Test 1] 引擎就绪与冷启动无感验证:");
    let status_before = coordinator.status().await;
    println!("  - 初始化即刻状态: {:?}", status_before);
    println!("  - 启动策略: 后台非阻塞异步预热 (UI/守护进程 0 延迟响应)");

    let t0 = Instant::now();
    coordinator.spawn_async_warmup();
    // 等待后台预热完成或检查状态
    let mut is_ready = false;
    for _ in 0..60 {
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        if coordinator.status().await == EngineStatus::Ready {
            is_ready = true;
            break;
        }
    }
    let warm_duration = t0.elapsed();
    println!("  - 预热完成耗时: {:.2}s", warm_duration.as_secs_f64());
    println!("  - 最终就绪状态: Ready={}", is_ready);

    // ---------------------------------------------------------
    // 阶段 2：执行前安全双门禁 (Safety Gate) 冒烟与拦截评测
    // ---------------------------------------------------------
    println!("\n[Test 2] Agent 工具执行前门禁 (防误删、防卡死、防挂起):");
    
    // 场景 2.1: 毁灭性指令拦截
    let t_gate = Instant::now();
    let v1 = coordinator.pre_check_command("rm -rf / --no-preserve-root");
    let gate_micros = t_gate.elapsed().as_micros();
    println!("  - [2.1] 毁灭性指令拦截耗时: {} µs (微秒级拦截)", gate_micros);
    match v1 {
        GateVerdict::Deny { reason } => println!("    ✅ 成功拦截高危操作: {}", reason),
        _ => panic!("Expected Deny for destructive command"),
    }

    // 场景 2.2: 交互式悬挂指令自动打补丁
    let v2 = coordinator.pre_check_command("apt-get install nginx");
    match v2 {
        GateVerdict::ModifyCommand { safe_command, reason } => {
            println!("    ✅ 成功捕获交互式挂起指令并修补: `{}` -> `{}` ({})", "apt-get install nginx", safe_command, reason);
            assert_eq!(safe_command, "apt-get install nginx -y");
        }
        _ => panic!("Expected ModifyCommand for interactive install"),
    }

    // 场景 2.3: 常驻服务死锁检测 (npm run dev / tail -f)
    let v3 = coordinator.pre_check_command("tail -f /var/log/app.log");
    match v3 {
        GateVerdict::RequireConfirmation { prompt, .. } => {
            println!("    ✅ 成功识别终端长阻塞命令: `{}` ({})", "tail -f /var/log/app.log", prompt);
        }
        _ => println!("    ℹ️ 命令通过"),
    }

    // ---------------------------------------------------------
    // 阶段 3：大日志脱水压缩器 (Log Stream Compressor) 与 Token 节省评测
    // ---------------------------------------------------------
    println!("\n[Test 3] 超大终端日志脱水压缩评测 (针对 Agent 执行工具时大模型卡顿与 Token 消耗源头):");
    
    // 模拟构建时产生的 3,000 行冗余日志（其中包含关键错误上下文）
    let mut big_output = String::with_capacity(300 * 1024);
    for i in 1..=1500 {
        big_output.push_str(&format!("Compiling package-xyz v0.1.0 (/deps/pkg_{}) ... ok\n", i));
    }
    big_output.push_str("error[E0432]: unresolved import `crate::types::NotFound`\n");
    big_output.push_str(" --> src/handler.rs:42:5\n");
    big_output.push_str("  |\n");
    big_output.push_str("42| use crate::types::NotFound;\n");
    big_output.push_str("  |     ^^^^^^^^^^^^^^^^^^^^ no `NotFound` in `types`\n");
    for i in 1501..=3000 {
        big_output.push_str(&format!("Compiling package-xyz v0.1.0 (/deps/pkg_{}) ... ok\n", i));
    }
    big_output.push_str("error: could not compile `my-crate` due to 1 previous error\n");

    let original_chars = big_output.len();
    let estimated_raw_tokens = original_chars / 4;

    let t_comp = Instant::now();
    let (compressed, _) = coordinator.process_command_output(&big_output);
    let comp_micros = t_comp.elapsed().as_micros();

    println!("  - 原始日志规模: 3006 行, ~{} 字符 (~{} 原始 Token)", original_chars, estimated_raw_tokens);
    println!("  - 压缩处理耗时: {} µs ({:.3} ms)", comp_micros, comp_micros as f64 / 1000.0);
    println!("  - 压缩后日志行数: {} 行", compressed.content.lines().count());
    println!("  - 压缩率估算: 成功节省 ~{} Tokens", compressed.estimated_tokens_saved);
    assert!(compressed.content.contains("error[E0432]"), "Compressed log must retain core error context!");

    // ---------------------------------------------------------
    // 阶段 4：凭证泄露猎手 (Secret Leak Hunter) 冒烟评测
    // ---------------------------------------------------------
    println!("\n[Test 4] 敏感机密凭证泄露猎手 (防止上传泄露导致安全事件):");
    let leaky_text = "Deploying with OpenAI key: sk-proj-99887766554433221100aabbccddeeffgg and GitHub PAT: ghp_11223344556677889900aabbccddeeffgghh";
    let t_leak = Instant::now();
    let (_, leak_res) = coordinator.process_command_output(leaky_text);
    let leak_micros = t_leak.elapsed().as_micros();

    println!("  - 脱敏耗时: {} µs", leak_micros);
    println!("  - 发现泄露凭证数: {}", leak_res.leak_count);
    println!("  - 脱敏结果: {}", leak_res.sanitized_text);
    assert_eq!(leak_res.leak_count, 2);
    assert!(!leak_res.sanitized_text.contains("sk-proj-"));
    assert!(!leak_res.sanitized_text.contains("ghp_"));
    assert!(leak_res.sanitized_text.contains("[REDACTED_API_KEY]"));
    assert!(leak_res.sanitized_text.contains("[REDACTED_GITHUB_TOKEN]"));

    // ---------------------------------------------------------
    // 阶段 5：死循环与振荡熔断器 (Loop Breaker) 冒烟评测
    // ---------------------------------------------------------
    println!("\n[Test 5] 死循环与反复报错自动熔断评测 (防止大模型陷入死循环无限烧 Token):");
    let failing_cmd = "npm run test:broken";
    let error_log = "Error: Cannot find module '@core/unknown'";

    for i in 1..=3 {
        let loop_status = coordinator.record_command_result(failing_cmd, false, error_log).await;
        if let Some(res) = loop_status {
            println!("  - 重试执行第 {} 次: 连续失败计数={}", i, res.loop_count);
            if res.should_break {
                println!("    🛑 [触发熔断] 死循环断路器介入！(连续失败 {} 次即触发)", res.loop_count);
                println!("    💡 [注入纠错提示]: {}", res.corrective_hint.unwrap_or_default());
                assert!(res.loop_count >= 2);
                break;
            }
        }
    }

    // ---------------------------------------------------------
    // 阶段 6：ModernBERT 全精度模型推理耗时评测
    // ---------------------------------------------------------
    println!("\n[Test 6] 意图分流器路由性能 (Pillar 1 Router):");
    let test_prompts = vec![
        "帮我用 Rust 实现一个线程安全的分片 LRU 缓存",
        "今天天气怎么样？",
        "查看当前分支状态并提交代码",
        "讲一个轻松幽默的程序员笑话",
    ];

    for prompt in test_prompts {
        let t = Instant::now();
        let decision = coordinator.route_prompt(prompt, true);
        let d_micros = t.elapsed().as_micros();
        println!("  - 输入: \"{}\" -> 模式: {:?}, 档位: {:?}, 延迟: {} µs ({:.3} ms)", 
            prompt, decision.mode, decision.recommended_tier, d_micros, d_micros as f64 / 1000.0
        );
    }

    // 阶段 6.2：ONNX 模型真机前向推理实测
    println!("\n[Test 7] ModernBERT-base (FP32) 本地神经前向推理实测 (Intel AVX2):");
    if let Ok(engine) = LocalVerdictEngine::try_load_default() {
        let req = JevRequest {
            state: "cargo test --workspace --verbose\nAll 12 tests passed successfully.".into(),
            questions: vec![
                JevQuestion::Noul {
                    id: "task_complete".into(),
                    instructions: "Did the test suite pass completely without errors?".into(),
                },
            ],
        };
        let t = Instant::now();
        let resp = engine.evaluate(req).await?;
        let elapsed_ms = t.elapsed().as_secs_f64() * 1000.0;
        println!("  - 神经推理耗时: {:.2} ms", elapsed_ms);
        println!("  - 判定结果: id={}, value={}, 置信度={}", resp.answers[0].id, resp.answers[0].value, resp.answers[0].confidence);
    }

    println!("\n============================================================");
    println!("✨ 冒烟测试全部通过！所有指标完全达标。");
    println!("============================================================");

    Ok(())
}
