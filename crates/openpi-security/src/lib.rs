//! openpi-security —— 技能安全扫描（纯静态，零 Node）
//!
//! 规则分类法源自 NVIDIA/SkillSpector（71 patterns / 17 categories），
//! 这里静态化其中最可用 regex/AST 判定的关键子集，用于扫描
//! `~/.openpi/memories/skills/**/*.md`，守住「不安全零容忍」铁律。

pub mod rules;
pub mod scanner;

pub use rules::{rule_count, compiled_rules, ioc_anchor_matcher, IOC_ANCHORS, Rule, Severity};
pub use scanner::{scan_content, scan_content_with_tools, scan_dir, scan_file, skills_dir, Finding, ScanReport};