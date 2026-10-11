//! 上下文切片构建器 (Context Builder)
//!
//! 核心原则：
//! 1. Memory ≠ Context。Memory 是海量长期存储，Context 是专为当前 Request 精心挑选的切片。
//! 2. 严格遵循 Token 预算硬顶（默认 1500 tokens / 约 6000 字符），防 Prompt 膨胀与污染。
//! 3. 结构化呈现：区分 User Profile / Preferences / Decisions / Feedback / Project Context。

use openpi_storage::{PersonalMemoryRecord, Storage};
use crate::lifecycle::{compute_memory_effective_score, MemoryCategory};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextPackage {
    pub prompt_fragment: String,
    pub matched_memories: Vec<PersonalMemoryRecord>,
    pub token_estimate: usize,
}

pub struct ContextBuilder;

impl ContextBuilder {
    /// 根据当前请求与活跃项目构建轻量精准的个人上下文切片
    pub fn build(
        storage: &Storage,
        query: &str,
        active_project: Option<&str>,
        max_tokens: usize,
    ) -> anyhow::Result<ContextPackage> {
        let max_budget = if max_tokens == 0 { 1500 } else { max_tokens };
        let char_limit = max_budget * 4; // 1 token ~ 4 chars 估算

        // 检索重要度 >= 0.25 的候选记忆（最多 60 条候选）
        let candidates = storage.list_personal_memories(None, Some(0.25), 60)?;
        if candidates.is_empty() {
            return Ok(ContextPackage {
                prompt_fragment: String::new(),
                matched_memories: Vec::new(),
                token_estimate: 0,
            });
        }

        let now_epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let query_lower = query.to_ascii_lowercase();
        let query_tokens: Vec<&str> = query_lower.split_whitespace().collect();

        // 为每条记忆打分 (relevance + effective score)
        let mut scored: Vec<(f32, PersonalMemoryRecord)> = candidates
            .into_iter()
            .map(|mem| {
                let cat = mem.category.parse::<MemoryCategory>().unwrap_or(MemoryCategory::Temporary);
                let half_life = cat.default_half_life_secs();

                // 尝试解析创建时间戳
                let created_epoch = chrono::DateTime::parse_from_rfc3339(&mem.created_at)
                    .map(|dt| dt.timestamp() as u64)
                    .unwrap_or(now_epoch);

                let last_acc_epoch = mem.last_accessed_at.as_deref().and_then(|s| {
                    chrono::DateTime::parse_from_rfc3339(s)
                        .map(|dt| dt.timestamp() as u64)
                        .ok()
                });

                let retention = compute_memory_effective_score(
                    mem.importance,
                    mem.confidence,
                    mem.access_count,
                    created_epoch,
                    last_acc_epoch,
                    half_life,
                    now_epoch,
                );

                // 相关度计算
                let mut relevance: f32 = 0.0;
                let content_lower = mem.content.to_ascii_lowercase();

                // 1. Profile / Preference 默认拥有较高基准相关度（随时约束行为）
                match cat {
                    MemoryCategory::Profile => relevance += 0.40,
                    MemoryCategory::Preference => relevance += 0.35,
                    MemoryCategory::Decision => relevance += 0.25,
                    MemoryCategory::Feedback => relevance += 0.30,
                    _ => relevance += 0.10,
                }

                // 2. 关键词与标签匹配
                for tag in &mem.tags {
                    let tag_lower = tag.to_ascii_lowercase();
                    if query_lower.contains(&tag_lower) {
                        relevance += 0.35;
                    }
                }

                for tok in &query_tokens {
                    if tok.len() >= 2 && content_lower.contains(tok) {
                        relevance += 0.15;
                    }
                }

                // 3. 项目匹配
                if let Some(proj) = active_project {
                    let proj_lower = proj.to_ascii_lowercase();
                    if content_lower.contains(&proj_lower)
                        || mem.tags.iter().any(|t| t.to_ascii_lowercase() == proj_lower)
                        || mem.related_entities.iter().any(|e| e.to_ascii_lowercase() == proj_lower)
                    {
                        relevance += 0.40;
                    }
                }

                let total_score = retention * 0.4 + relevance.min(1.0) * 0.6;
                (total_score, mem)
            })
            .collect();

        // 按总分降序排列
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        // 归纳并组装 Markdown 提示词，遵守字符预算
        let mut selected_memories = Vec::new();
        let mut profile_prefs = Vec::new();
        let mut decisions_feedback = Vec::new();
        let mut project_context = Vec::new();
        let mut current_chars = 0;

        for (_score, mem) in scored {
            let cat = mem.category.parse::<MemoryCategory>().unwrap_or(MemoryCategory::Temporary);
            let item_line = format!("- [{}] {}", cat, mem.content);
            let line_len = item_line.len() + 1;

            if current_chars + line_len > char_limit {
                break;
            }

            current_chars += line_len;
            selected_memories.push(mem.clone());

            match cat {
                MemoryCategory::Profile | MemoryCategory::Preference => {
                    profile_prefs.push(item_line);
                }
                MemoryCategory::Decision | MemoryCategory::Feedback => {
                    decisions_feedback.push(item_line);
                }
                _ => {
                    project_context.push(item_line);
                }
            }
        }

        if selected_memories.is_empty() {
            return Ok(ContextPackage {
                prompt_fragment: String::new(),
                matched_memories: Vec::new(),
                token_estimate: 0,
            });
        }

        // 触碰被选中的记忆（touch 记录，强化记忆）
        let now_iso = chrono::Utc::now().to_rfc3339();
        for mem in &selected_memories {
            let _ = storage.touch_personal_memory(&mem.id, &now_iso);
        }

        let mut output = String::with_capacity(current_chars + 128);
        output.push_str("[OpenPI Personal Memory Context]\n");

        if !profile_prefs.is_empty() {
            output.push_str("## Core Profile & Preferences\n");
            for line in profile_prefs {
                output.push_str(&line);
                output.push('\n');
            }
        }

        if !decisions_feedback.is_empty() {
            output.push_str("## Architectural Decisions & Feedback\n");
            for line in decisions_feedback {
                output.push_str(&line);
                output.push('\n');
            }
        }

        if !project_context.is_empty() {
            output.push_str("## Active Context & Experiences\n");
            for line in project_context {
                output.push_str(&line);
                output.push('\n');
            }
        }

        let token_estimate = output.len() / 4;
        Ok(ContextPackage {
            prompt_fragment: output,
            matched_memories: selected_memories,
            token_estimate,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_context_builder_budget_and_filtering() {
        let storage = Storage::in_memory().unwrap();

        // 插入多条记忆
        let mem1 = PersonalMemoryRecord {
            id: "m1".into(),
            category: "preference".into(),
            content: "Never modify files using sed; use edit tools directly".into(),
            source: "session-1".into(),
            confidence: 0.95,
            importance: 0.9,
            access_count: 5,
            created_at: "2026-10-07T20:00:00Z".into(),
            updated_at: "2026-10-07T20:00:00Z".into(),
            last_accessed_at: None,
            expires_at: None,
            tags: vec!["rust".into(), "edit".into()],
            related_entities: vec!["openpi".into()],
        };
        storage.upsert_personal_memory(&mem1).unwrap();

        let mem2 = PersonalMemoryRecord {
            id: "m2".into(),
            category: "decision".into(),
            content: "Adopted actor-critic async pipeline for 10x review latency boost".into(),
            source: "session-1".into(),
            confidence: 0.98,
            importance: 0.95,
            access_count: 2,
            created_at: "2026-10-07T21:00:00Z".into(),
            updated_at: "2026-10-07T21:00:00Z".into(),
            last_accessed_at: None,
            expires_at: None,
            tags: vec!["reviewer".into(), "architecture".into()],
            related_entities: vec!["engine".into()],
        };
        storage.upsert_personal_memory(&mem2).unwrap();

        let pkg = ContextBuilder::build(&storage, "Please review my rust code", Some("openpi"), 500).unwrap();
        assert!(!pkg.prompt_fragment.is_empty());
        assert!(pkg.token_estimate <= 500);
        assert!(pkg.prompt_fragment.contains("Personal Memory Context"));
        assert!(pkg.prompt_fragment.contains("sed"));
        assert!(!pkg.matched_memories.is_empty());
    }
}
