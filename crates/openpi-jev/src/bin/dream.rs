use std::path::PathBuf;
use std::time::Instant;
use openpi_jev::dreamer::{DreamerEngine, SessionTreeParser, FailureClass};

fn get_home_dir() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("."))
}

fn main() -> anyhow::Result<()> {
    println!("============================================================");
    println!("🌌 OpenPI Dream-RSI: 离线做梦回放与策略自优化引擎");
    println!("   Recursive Self-Improvement through Evolving Worlds");
    println!("============================================================");

    let home = get_home_dir();
    let sessions_dir = home.join(".openpi").join("sessions");

    if !sessions_dir.exists() {
        println!("⚠️ 未找到会话目录: {:?}", sessions_dir);
        return Ok(());
    }

    let mut session_files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&sessions_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("jsonl") {
                session_files.push(path);
            }
        }
    }

    if session_files.is_empty() {
        println!("ℹ️ 会话目录为空，暂无可回放的真实历史会话。");
        return Ok(());
    }

    println!("📁 扫描到本地历史真实会话: {} 个", session_files.len());
    for (i, p) in session_files.iter().enumerate() {
        let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        println!("   [{}] {:?} ({:.1} KB)", i + 1, p.file_name().unwrap(), size as f64 / 1024.0);
    }

    let parser = SessionTreeParser::new();
    let engine = DreamerEngine::new(4); // 模拟 4 个并发 worker
    let candidate_betas = vec![0.2, 0.4, 0.6, 0.8];

    for (idx, session_path) in session_files.iter().enumerate() {
        let filename = session_path.file_name().and_then(|s| s.to_str()).unwrap_or("unknown");
        println!("\n============================================================");
        println!("🔍 [Session {}/{}] 深度解析与回放: {}", idx + 1, session_files.len(), filename);

        let t_parse = Instant::now();
        let tree = match parser.parse_openpi_session_file(session_path) {
            Ok(t) => t,
            Err(e) => {
                println!("  ❌ 解析失败: {:?}", e);
                continue;
            }
        };
        let parse_ms = t_parse.elapsed().as_secs_f64() * 1000.0;

        let total_nodes = tree.total_probes();
        println!("  ⏱️ 转换发现树耗时: {:.2} ms", parse_ms);
        println!("  🌳 发现树规模: 共 {} 个节点 (1 个 Root + {} 步工具调用)", total_nodes + 1, total_nodes);

        if total_nodes == 0 {
            println!("  ℹ️ 该会话无工具调用记录，跳过回放。");
            continue;
        }

        // 统计错误分级分布
        let mut ok_count = 0;
        let mut repairable_count = 0;
        let mut hard_count = 0;
        for node in tree.nodes.values() {
            if node.id == tree.root_id { continue; }
            match &node.fail_class {
                FailureClass::Ok => ok_count += 1,
                FailureClass::RepairableImplementation { .. } => repairable_count += 1,
                FailureClass::HardAlgorithmic { .. } => hard_count += 1,
                FailureClass::EnvironmentFailure { .. } => repairable_count += 1,
            }
        }

        println!("  📊 发现树执行结果画像:");
        println!("     - 正常/达标尝试 (Ok):           {} 步", ok_count);
        println!("     - 可自愈实现级失误 (Repairable): {} 步 (语法/参数/依赖错误，保留重试配额)", repairable_count);
        println!("     - 硬性算法级失败 (Hard):         {} 步", hard_count);

        // 打印前 3 个解析节点作为证据
        println!("  📝 初始几步真实执行样本:");
        let mut sample_nodes: Vec<_> = tree.nodes.values().filter(|n| n.id != tree.root_id).collect();
        sample_nodes.sort_by_key(|n| n.step);
        for s_node in sample_nodes.iter().take(3) {
            let status_str = match &s_node.fail_class {
                FailureClass::Ok => "✅ 成功",
                FailureClass::RepairableImplementation { .. } => "⚠️ 可自愈错误",
                _ => "❌ 致命错误",
            };
            println!("     • 步 #{:02} | 命令: {:<12} | 状态: {} | 得分: {:.1}", 
                s_node.step, s_node.cmd, status_str, s_node.score
            );
        }

        // 离线做梦回放与策略对比测试
        println!("  💤 开始离线做梦模拟 (Offline Dreaming - 0 Token / 0 沙箱消耗)...");
        println!("  ┌────────┬─────────┬────────┬────────┬─────────────┬──────────────┐");
        println!("  │  Beta  │ Quality │ Rounds │ Probes │ Parallelism │ ParetoReward │");
        println!("  ├────────┼─────────┼────────┼────────┼─────────────┼──────────────┤");

        let mut best_beta = 0.5;
        let mut best_reward = f64::NEG_INFINITY;

        for &beta in &candidate_betas {
            let m = engine.dream_and_evaluate(&tree, beta);
            if m.pareto_reward > best_reward {
                best_reward = m.pareto_reward;
                best_beta = beta;
            }
            println!(
                "  │  {:4.1}  │  {:5.2}  │  {:4}  │  {:4}  │   {:5.2}x   │   {:8.4}   │",
                beta, m.discovery_quality, m.decision_rounds, m.total_probes, m.parallelism_efficiency, m.pareto_reward
            );
        }
        println!("  └────────┴─────────┴────────┴────────┴─────────────┴──────────────┘");
        println!("  🏆 该历史情境下的最优策略: Beta* = {:.1} (Pareto Reward = {:.4})", best_beta, best_reward);
    }

    println!("\n============================================================");
    println!("✨ 全量本地历史会话离线做梦回放完成！已验证 0 Token 策略自演化。");
    println!("============================================================");

    Ok(())
}
