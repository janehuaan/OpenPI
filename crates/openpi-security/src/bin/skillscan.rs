//! skillscan —— OpenPI 技能安全扫描 CLI（纯静态，零 Node）。
//!
//! 用法：
//!   skillscan [--dir <path>] [--json] [--min <low|medium|high|critical>]
//! 默认扫描 ~/.openpi/memories/skills，存在 High/Critical 时退出码为 1。

use std::path::PathBuf;
use std::process::ExitCode;

use openpi_security::{rule_count, scan_dir, skills_dir, Severity};

fn parse_severity(s: &str) -> Option<Severity> {
    match s.to_ascii_lowercase().as_str() {
        "low" => Some(Severity::Low),
        "medium" => Some(Severity::Medium),
        "high" => Some(Severity::High),
        "critical" => Some(Severity::Critical),
        _ => None,
    }
}

fn main() -> ExitCode {
    let mut dir: Option<PathBuf> = None;
    let mut json = false;
    let mut min = Severity::Low;

    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--dir" | "-d" => dir = args.next().map(PathBuf::from),
            "--json" => json = true,
            "--min" => {
                match args.next().and_then(|s| parse_severity(&s)) {
                    Some(s) => min = s,
                    None => {
                        eprintln!("无效 --min（low|medium|high|critical）");
                        return ExitCode::from(2);
                    }
                }
            }
            "--help" | "-h" => {
                println!("skillscan —— 扫描 OpenPI 技能安全风险");
                println!("用法: skillscan [--dir <path>] [--json] [--min <sev>]");
                return ExitCode::SUCCESS;
            }
            other => {
                eprintln!("未知参数: {other}");
                return ExitCode::from(2);
            }
        }
    }

    let dir = dir.unwrap_or_else(skills_dir);
    if !dir.exists() {
        eprintln!("目录不存在: {}", dir.display());
        return ExitCode::from(2);
    }

    let mut report = scan_dir(&dir);
    report.findings.retain(|f| f.severity >= min);

    if json {
        println!("{}", serde_json::to_string_pretty(&report).unwrap());
    } else {
        print_human(&dir, &report);
    }

    if report.has_blocking() {
        ExitCode::FAILURE
    } else {
        ExitCode::SUCCESS
    }
}

fn print_human(dir: &std::path::Path, r: &openpi_security::ScanReport) {
    println!("🛡️  OpenPI 技能安全扫描");
    println!("   规则数: {}   目标: {}", rule_count(), dir.display());
    println!("   扫描技能文件: {}", r.files_scanned);
    println!("{}", "─".repeat(64));

    if r.findings.is_empty() {
        println!("✅ 未发现风险命中");
        return;
    }

    let mut cur = String::new();
    for f in &r.findings {
        if f.file != cur {
            cur = f.file.clone();
            println!("\n📄 {cur}");
        }
        println!(
            "   {} [{}] {} · {}  (L{})",
            f.severity.emoji(),
            f.severity.label(),
            f.rule_id,
            f.category,
            f.line
        );
        println!("      {} — {}", f.description, f.snippet);
    }

    println!("\n{}", "─".repeat(64));
    println!(
        "汇总: 🟥 {}  🟧 {}  🟨 {}  ⬜ {}   合计 {}",
        r.count(Severity::Critical),
        r.count(Severity::High),
        r.count(Severity::Medium),
        r.count(Severity::Low),
        r.findings.len()
    );
    if r.has_blocking() {
        println!("❌ 存在 High/Critical 风险，需处理");
    } else {
        println!("⚠️  仅 Low/Medium，建议人工复核");
    }
}