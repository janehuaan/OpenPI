//! 主动服务与 Today 晨报引擎 (Proactive Engine & Daily Briefing)
//!
//! 核心原则：
//! 1. 改变“空输入框发呆”的困境，向 C 端主动管家跃迁。
//! 2. 每天自动梳理：活跃长程目标 (Active Goals)、高优先级个人准则 (Key Memories) 与可交互行动卡片 (Action Cards)。

use openpi_storage::{PersonalGoalRecord, PersonalMemoryRecord, Storage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCard {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub action_type: String, // run_tests | resume_goal | review_diff | execute_task
    pub payload: serde_json::Value,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayBriefing {
    pub date: String,
    pub greeting: String,
    pub daily_focus: String,
    pub active_goals: Vec<PersonalGoalRecord>,
    pub action_cards: Vec<ActionCard>,
    pub key_memories: Vec<PersonalMemoryRecord>,
    pub generated_at: String,
}

/// 生成晨报所需的真实上下文（全部来自持久化状态，不再硬编码）。
#[derive(Debug, Clone, Default)]
pub struct BriefingInput {
    pub nickname: Option<String>,
    pub active_goals: Vec<PersonalGoalRecord>,
    pub key_memories: Vec<PersonalMemoryRecord>,
    pub uncommitted_dirs: Vec<String>,
    pub open_cards: Vec<ActionCard>,
}

pub struct ProactiveEngine;

impl ProactiveEngine {
    /// 从存储聚合上下文并生成《Today 今日简报与行动卡片》。
    pub fn generate_briefing(storage: &Storage) -> anyhow::Result<TodayBriefing> {
        let input = Self::collect_input(storage);
        Ok(Self::generate_briefing_from(&input))
    }

    /// 采集真实上下文（活跃目标 / 高置信记忆 / 未处理卡片 / 未提交目录 / 昵称）。
    pub fn collect_input(storage: &Storage) -> BriefingInput {
        let active_goals = storage
            .list_personal_goals(Some("active"), 5)
            .unwrap_or_default();
        let key_memories = storage
            .list_personal_memories(None, Some(0.85), 5)
            .unwrap_or_default();
        let open_cards = storage
            .list_action_cards(Some("open"), 5)
            .unwrap_or_default()
            .into_iter()
            .map(|c| ActionCard {
                id: c.id,
                title: c.title,
                summary: c.summary,
                action_type: c.action_type,
                payload: serde_json::from_str(&c.payload).unwrap_or(serde_json::Value::Null),
                created_at: c.created_at,
            })
            .collect();

        BriefingInput {
            nickname: resolve_nickname(),
            active_goals,
            key_memories,
            uncommitted_dirs: load_uncommitted_dirs(storage),
            open_cards,
        }
    }

    /// 纯函数：由上下文生成晨报（可单测，无 IO）。
    pub fn generate_briefing_from(input: &BriefingInput) -> TodayBriefing {
        let now = chrono::Local::now();
        let date_str = now.format("%Y-%m-%d").to_string();
        let hour = now.format("%H").to_string().parse::<u32>().unwrap_or(9);
        let name = input
            .nickname
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("你");

        let greeting = if hour < 12 {
            format!("早安，{}！新的一天，我们来看一下今天的重点。☀️", name)
        } else if hour < 18 {
            format!("下午好，{}！喝口水，我帮你梳理一下进展。☕", name)
        } else {
            format!("晚上好，{}！来看看今天的目标与收尾进展。🌙", name)
        };

        let daily_focus = if let Some(top) = input.active_goals.first() {
            format!(
                "🎯 主线目标：{}（当前推进度 {:.0}%）",
                top.title,
                top.progress * 100.0
            )
        } else {
            "🎯 今天还没有进行中的目标，可以从一件小事开始。".to_string()
        };

        let now_iso = chrono::Utc::now().to_rfc3339();
        let mut action_cards: Vec<ActionCard> = Vec::new();

        // 1. 活跃目标 → 一键推进
        for goal in &input.active_goals {
            action_cards.push(ActionCard {
                id: format!("card-goal-{}", goal.id),
                title: format!("推进目标：{}", goal.title),
                summary: goal
                    .description
                    .clone()
                    .unwrap_or_else(|| "点击一键在会话中继续推进此目标".to_string()),
                action_type: "resume_goal".to_string(),
                payload: serde_json::json!({ "goalId": goal.id, "title": goal.title }),
                created_at: now_iso.clone(),
            });
        }

        // 2. 未提交变更 → 代码审查
        if !input.uncommitted_dirs.is_empty() {
            action_cards.push(ActionCard {
                id: "card-uncommitted".to_string(),
                title: "工作区存在未提交变更".to_string(),
                summary: format!(
                    "{} 个目录有未提交改动，建议审查后再继续",
                    input.uncommitted_dirs.len()
                ),
                action_type: "review_diff".to_string(),
                payload: serde_json::json!({
                    "prompt": "请帮我审查当前工作区的未提交变更（git diff），梳理改动并指出潜在隐患。",
                    "dirs": input.uncommitted_dirs,
                }),
                created_at: now_iso.clone(),
            });
        }

        // 3. 续接尚未处理的行动卡片（最多 3 张）
        for card in input.open_cards.iter().take(3) {
            action_cards.push(card.clone());
        }

        TodayBriefing {
            date: date_str,
            greeting,
            daily_focus,
            active_goals: input.active_goals.clone(),
            action_cards,
            key_memories: input.key_memories.clone(),
            generated_at: now_iso,
        }
    }
}

/// 解析用户昵称：优先 `profile.json` 的 nickname / userName，否则 None。
fn resolve_nickname() -> Option<String> {
    openpi_engine::PersonaConfig::load().user_name
}

/// 读取由 `proactive_loop` 记录的「未提交目录」集合。
fn load_uncommitted_dirs(storage: &Storage) -> Vec<String> {
    storage
        .get_kv("proactive:uncommitted_dirs")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proactive_engine_briefing() {
        let storage = Storage::in_memory().unwrap();
        let briefing = ProactiveEngine::generate_briefing(&storage).unwrap();

        assert!(!briefing.greeting.is_empty());
        assert!(!briefing.daily_focus.is_empty());
        // 空状态不再产出写死的默认卡片
        assert!(briefing.action_cards.is_empty());
    }

    #[test]
    fn test_briefing_from_input_is_real() {
        let input = BriefingInput {
            nickname: Some("Huaan".into()),
            active_goals: vec![],
            key_memories: vec![],
            uncommitted_dirs: vec!["/repo".into()],
            open_cards: vec![],
        };
        let briefing = ProactiveEngine::generate_briefing_from(&input);
        assert!(briefing.greeting.contains("Huaan"));
        assert!(briefing
            .action_cards
            .iter()
            .any(|c| c.action_type == "review_diff"));
    }
}
