use anyhow::Result;
use std::fs;
use std::path::PathBuf;
use tracing::info;
use crate::config::{agent_dir, openpi_dir};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SynthesizedSkill {
    pub name: String,
    pub description: String,
    pub content: String,
    pub file_path: PathBuf,
    pub synthesized: bool,
    pub scripts_dir: Option<PathBuf>,
}

/// Directory where synthesized skills are stored
pub fn synthesized_skills_dir() -> PathBuf {
    openpi_dir().join("memories").join("skills")
}

/// Sanitizes a string into a clean, lowercase kebab-case slug for skill folder names
pub fn sanitize_skill_slug(raw: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = true;

    for c in raw.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
            last_dash = false;
        } else if c == '-' || c == '_' || c.is_whitespace() || c == '/' || c == '.' {
            if !last_dash {
                slug.push('-');
                last_dash = true;
            }
        }
    }

    let trimmed = slug.trim_matches('-').to_string();
    if trimmed.is_empty() {
        format!("skill-{}", chrono::Local::now().format("%m%d-%H%M"))
    } else {
        trimmed
    }
}

/// Persists a synthesized skill to ~/.openpi/memories/skills/<slug>/SKILL.md
pub fn save_synthesized_skill(name: &str, description: &str, raw_content: &str) -> Result<PathBuf> {
    let slug = sanitize_skill_slug(name);
    let target_dir = synthesized_skills_dir().join(&slug);
    fs::create_dir_all(&target_dir)?;

    let skill_file = target_dir.join("SKILL.md");
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    let clean_desc = description.trim().replace('"', "\\\"");
    let trimmed_content = raw_content.trim();

    let formatted_content = if trimmed_content.starts_with("---") {
        trimmed_content.to_string()
    } else {
        format!(
            "---\nname: {}\ndescription: \"{}\"\nsynthesized: true\ncreated_at: {}\n---\n\n{}\n",
            slug,
            clean_desc,
            today,
            if trimmed_content.is_empty() {
                format!("# {}\n\n{}", name, description)
            } else {
                trimmed_content.to_string()
            }
        )
    };

    fs::write(&skill_file, formatted_content)?;
    info!("Synthesized skill successfully saved: {}", skill_file.display());
    Ok(skill_file)
}

/// Scans both user-curated skills (~/.openpi/agent/skills) and synthesized skills (~/.openpi/memories/skills)
pub fn scan_all_skills() -> Vec<SynthesizedSkill> {
    let mut skills = Vec::new();
    let mut seen = std::collections::HashSet::new();

    let scan_dirs = [
        synthesized_skills_dir(),
        agent_dir().join("skills"),
    ];

    for dir in &scan_dirs {
        if !dir.exists() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let skill_file = if path.is_dir() {
                    let direct = path.join("SKILL.md");
                    if direct.exists() {
                        direct
                    } else {
                        continue;
                    }
                } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    path.clone()
                } else {
                    continue;
                };

                let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("skill").to_string();
                if seen.contains(&name) {
                    continue;
                }
                seen.insert(name.clone());

                let content = fs::read_to_string(&skill_file).unwrap_or_default();
                let mut desc = String::new();
                let mut is_synth = false;

                for line in content.lines().take(25) {
                    if line.starts_with("description:") {
                        desc = line
                            .trim_start_matches("description:")
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'')
                            .to_string();
                    } else if line.contains("synthesized: true") {
                        is_synth = true;
                    }
                }

                if desc.is_empty() {
                    for line in content.lines().take(10) {
                        if line.starts_with('#') {
                            desc = line.trim_start_matches('#').trim().to_string();
                            break;
                        }
                    }
                }

                let mut scripts_dir = None;
                if let Some(parent) = skill_file.parent() {
                    let potential_scripts = parent.join("scripts");
                    if potential_scripts.is_dir() {
                        scripts_dir = Some(potential_scripts);
                    }
                }

                skills.push(SynthesizedSkill {
                    name,
                    description: desc,
                    content,
                    file_path: skill_file,
                    synthesized: is_synth,
                    scripts_dir,
                });
            }
        }
    }

    skills
}

/// Formats active skills into a concise, high-signal system prompt directive
pub fn format_skills_prompt_directive(skills: &[SynthesizedSkill]) -> String {
    if skills.is_empty() {
        return String::new();
    }

    let mut lines = Vec::new();
    for s in skills.iter().take(12) {
        let desc = if s.description.is_empty() { "标准执行规约" } else { s.description.as_str() };
        let scripts_info = if let Some(ref sdir) = s.scripts_dir {
            format!(" [含确定性资产脚本: {}]", sdir.display())
        } else {
            String::new()
        };
        lines.push(format!("- **{}**: {} (规约定义: ~/.openpi/memories/skills/{}/SKILL.md){}", s.name, desc, s.name, scripts_info));
    }

    format!(
        "\n\n【自进化技能库与标准执行规约 (Synthesized Skills & Execution SOPs)】\n\
         当前系统已沉淀以下标准技能规范。若当前任务触及相关技术栈、环境排错或流程，必须严格遵守相应规范执行；亦可使用 save_skill 工具将新踩坑排错经验固化为新技能：\n\
         {}\n",
        lines.join("\n")
    )
}

/// Evaluates if a set of troubleshooting decisions represents a generalizable technical pattern
/// and synthesizes a structured skill if appropriate.
pub fn evaluate_and_distill_skill(topic: &str, decisions: &str) -> Option<SynthesizedSkill> {
    if topic.trim().is_empty() || decisions.trim().is_empty() {
        return None;
    }

    // Must be substantial technical work (contains commands, configs, or multi-step fixes)
    let is_substantial = decisions.contains("bash")
        || decisions.contains("npm")
        || decisions.contains("cargo")
        || decisions.contains("node")
        || decisions.contains("tauri")
        || decisions.contains("fix")
        || decisions.contains("配置")
        || decisions.contains("排查")
        || decisions.contains("编译")
        || decisions.contains("重构")
        || decisions.contains("解决")
        || decisions.lines().count() >= 2;

    if !is_substantial {
        return None;
    }

    let slug = sanitize_skill_slug(topic);
    let title = topic.trim_matches(|c: char| c == '【' || c == '】' || c == '#' || c.is_whitespace());

    let content = format!(
        "# {} - 标准自愈与排障操作规约 (Synthesized SOP)\n\n\
         ## 1. 触发场景与识别特征 (Trigger Criteria)\n\
         - **适用场景**: {}\n\
         - **核心特征**: 针对该类技术栈或命令在特定系统环境下的典型踩坑与冲突解决。\n\n\
         ## 2. 根因分析与避坑指南 (Root Cause & Anti-Patterns)\n\
         - 避免盲目全量覆盖或暴力重装；\n\
         - 严格检查前置依赖与系统锁，防止并发冲突。\n\n\
         ## 3. 标准解决闭环流程 (Verified Resolution Steps)\n\
         {}\n\n\
         ## 4. 交付验收准则 (Verification Protocol)\n\
         - 必须通过原生测试或真实环境命令校验；\n\
         - 保证进程稳定存活且无内存/资源泄漏。\n",
        title,
        title,
        decisions.trim()
    );

    let description = format!("针对「{}」场景的标准排错与自动化解决规约", title);

    Some(SynthesizedSkill {
        name: slug,
        description,
        content,
        file_path: PathBuf::new(),
        synthesized: true,
        scripts_dir: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slug_sanitization() {
        assert_eq!(sanitize_skill_slug("MacPorts Node.js 升级至 v22"), "macports-node-js-v22");
        assert_eq!(sanitize_skill_slug("tauri_sqlite_build-fix"), "tauri-sqlite-build-fix");
        assert_eq!(sanitize_skill_slug("  TDD Workflow !!  "), "tdd-workflow");
    }

    #[test]
    fn test_format_skills_directive() {
        let skills = vec![
            SynthesizedSkill {
                name: "tdd-workflow".to_string(),
                description: "测试驱动开发红绿循环".to_string(),
                content: "# TDD".to_string(),
                file_path: PathBuf::from("skills/tdd/SKILL.md"),
                synthesized: false,
                scripts_dir: None,
            },
        ];
        let directive = format_skills_prompt_directive(&skills);
        assert!(directive.contains("tdd-workflow"));
        assert!(directive.contains("测试驱动开发红绿循环"));
    }

    #[test]
    fn test_evaluate_and_distill() {
        let topic = "Node.js MacPorts 代理中转与反代";
        let decisions = "- 切换 Node 默认版本至 v22\n- 配置 PATH 环境变量生效并验证退出码为 0";
        let skill = evaluate_and_distill_skill(topic, decisions);
        assert!(skill.is_some());
        let s = skill.unwrap();
        assert!(s.content.contains("Node.js MacPorts"));
        assert!(s.content.contains("Verified Resolution Steps"));
    }
}
