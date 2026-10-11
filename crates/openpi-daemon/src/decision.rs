//! 智能决策引擎与 ActionScore 缓冲池 (Decision Engine & ActionScore)
//!
//! 核心原则：
//! 1. 彻底防止主动式 Agent 盲目自作主张、乱删文件或过度打扰用户。
//! 2. 核心决策公式：
//!    ActionScore = Importance * Urgency * Confidence * Permission - InterruptionCost
//! 3. 严格分级：低分忽略，中分静默记录或生成低打扰卡片，高分纯读任务自主分析，高危写操作强制向用户请示。

use crate::event_bus::AgentEvent;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum DecisionAction {
    Ignore { reason: String },
    Remember { category: String, content: String },
    CardSuggestion {
        title: String,
        description: String,
        action_type: String,
        payload: serde_json::Value,
    },
    ExecuteProactive { task_name: String, objective: String },
    AskUser { question: String, choices: Vec<String> },
}

pub struct DecisionEngine;

impl DecisionEngine {
    /// 计算决策行动分值并产出理性动作
    pub fn evaluate(event: &AgentEvent) -> DecisionAction {
        // 每类事件的行动价值画像。注意：原 `git_uncommitted` 的 interruption_cost
        // 使该分支的 ActionScore 上限低于 0.20，永远只能被静默忽略 —— 已重标定，
        // 让真实未提交变更能产出「低打扰卡片」。
        let (urgency, confidence, permission, interruption_cost) = match event.event_type.as_str() {
            "morning_brief" => (0.9, 0.95, 1.0, 0.0),
            "git_uncommitted" => (0.8, 0.85, 0.9, 0.0),
            "timer_expired" => (0.7, 0.90, 1.0, 0.1),
            "file_changed" => (0.4, 0.60, 0.6, 0.2),
            "session_idle" => (0.2, 0.70, 0.8, 0.4),
            "feedback" => (0.6, 0.90, 1.0, 0.05),
            _ => (0.3, 0.50, 0.5, 0.3),
        };

        // ActionScore = Importance * Urgency * Confidence * Permission - InterruptionCost
        let score = (event.importance * urgency * confidence * permission) - interruption_cost;

        if score < 0.20 {
            DecisionAction::Ignore {
                reason: format!("ActionScore ({:.2}) below threshold", score),
            }
        } else if score < 0.45 {
            // 中低分：静默记入记忆，不惊动用户
            let summary = event
                .payload
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("Event observed");
            DecisionAction::Remember {
                category: "experience".to_string(),
                content: format!("[{}] {}", event.event_type, summary),
            }
        } else if score < 0.70 {
            // 中高分：生成可交互的温和卡片建议
            let title = match event.event_type.as_str() {
                "morning_brief" => "今日早间简报已就绪",
                "git_uncommitted" => "检测到工作区存在未提交变动",
                "timer_expired" => "定时监测提醒",
                _ => "建议关注的系统动态",
            };
            DecisionAction::CardSuggestion {
                title: title.to_string(),
                description: event.payload.to_string(),
                action_type: event.event_type.clone(),
                payload: event.payload.clone(),
            }
        } else {
            // 高分：如果是定时晨报或只读分析，可后台自主执行
            if event.event_type == "morning_brief" {
                DecisionAction::ExecuteProactive {
                    task_name: "morning_brief_synthesis".to_string(),
                    objective: "Synthesize daily progress and active goals into a clean morning brief".to_string(),
                }
            } else {
                DecisionAction::AskUser {
                    question: format!("发现重要事件 ({})，是否授权处理？", event.event_type),
                    choices: vec!["立即处理".into(), "推迟".into(), "忽略".into()],
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decision_engine_scoring() {
        // 低重要性事件被静默忽略
        let low_evt = AgentEvent {
            id: "e1".into(),
            event_type: "session_idle".into(),
            timestamp: 0,
            source: "supervisor".into(),
            payload: serde_json::json!({}),
            importance: 0.1,
        };
        assert!(matches!(DecisionEngine::evaluate(&low_evt), DecisionAction::Ignore { .. }));

        // 晨报事件高置信度高分
        let brief_evt = AgentEvent {
            id: "e2".into(),
            event_type: "morning_brief".into(),
            timestamp: 0,
            source: "scheduler".into(),
            payload: serde_json::json!({}),
            importance: 0.95,
        };
        assert!(matches!(DecisionEngine::evaluate(&brief_evt), DecisionAction::ExecuteProactive { .. }));
    }
}
