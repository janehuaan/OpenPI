//! 个人目标状态机与跨会话生命周期 (Personal Goal State Machine)
//!
//! 核心原则：
//! 1. Goal-Centric 替代 Session-Centric：一个目标可以跨越多个会话、经历数天乃至数周。
//! 2. 状态机严格流转：Draft -> Active -> Blocked / Waiting / Completed / Cancelled -> Archived。
//! 3. 关联项目、约束条件与验收标准，保持执行方向不漂移。

use openpi_storage::{PersonalGoalRecord, Storage};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GoalStatus {
    Draft,
    Active,
    Blocked,
    Waiting,
    Completed,
    Cancelled,
    Archived,
}

impl GoalStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Active => "active",
            Self::Blocked => "blocked",
            Self::Waiting => "waiting",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Archived => "archived",
        }
    }

    /// 检验状态跃迁是否合法
    pub fn can_transition_to(&self, target: GoalStatus) -> bool {
        match self {
            Self::Draft => matches!(target, Self::Active | Self::Cancelled),
            Self::Active => matches!(target, Self::Blocked | Self::Waiting | Self::Completed | Self::Cancelled),
            Self::Blocked => matches!(target, Self::Active | Self::Cancelled),
            Self::Waiting => matches!(target, Self::Active | Self::Cancelled),
            Self::Completed => matches!(target, Self::Archived),
            Self::Cancelled => matches!(target, Self::Archived),
            Self::Archived => false,
        }
    }
}

impl fmt::Display for GoalStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl FromStr for GoalStatus {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "draft" => Ok(Self::Draft),
            "active" => Ok(Self::Active),
            "blocked" => Ok(Self::Blocked),
            "waiting" => Ok(Self::Waiting),
            "completed" => Ok(Self::Completed),
            "cancelled" => Ok(Self::Cancelled),
            "archived" => Ok(Self::Archived),
            _ => Err(()),
        }
    }
}

pub struct GoalManager;

impl GoalManager {
    /// 创建新目标并持久化
    #[allow(clippy::too_many_arguments)]
    pub fn create_goal(
        storage: &Storage,
        id: impl Into<String>,
        title: impl Into<String>,
        description: Option<String>,
        priority: i32,
        source: impl Into<String>,
        constraints: Vec<String>,
        success_criteria: Vec<String>,
        deadline: Option<String>,
    ) -> anyhow::Result<PersonalGoalRecord> {
        let now = chrono::Utc::now().to_rfc3339();
        let record = PersonalGoalRecord {
            id: id.into(),
            title: title.into(),
            description,
            status: GoalStatus::Active.as_str().to_string(),
            priority: priority.clamp(1, 5),
            source: source.into(),
            progress: 0.0,
            constraints,
            success_criteria,
            active_session_id: None,
            created_at: now.clone(),
            updated_at: now,
            deadline,
        };

        storage.upsert_personal_goal(&record)?;
        Ok(record)
    }

    /// 目标状态跃迁，伴随严格状态机校验
    pub fn transition_status(
        storage: &Storage,
        goal_id: &str,
        new_status: GoalStatus,
    ) -> anyhow::Result<PersonalGoalRecord> {
        let mut goal = storage
            .get_personal_goal(goal_id)?
            .ok_or_else(|| anyhow::anyhow!("Goal not found: {}", goal_id))?;

        let current_status = goal.status.parse::<GoalStatus>().unwrap_or(GoalStatus::Draft);
        if !current_status.can_transition_to(new_status) {
            anyhow::bail!(
                "Invalid goal status transition: {} -> {}",
                current_status,
                new_status
            );
        }

        let now = chrono::Utc::now().to_rfc3339();
        goal.status = new_status.as_str().to_string();
        goal.updated_at = now;
        storage.upsert_personal_goal(&goal)?;
        Ok(goal)
    }

    /// 更新目标推进进度 (0.0 ~ 1.0)，达到 1.0 时自动跃迁为 completed
    pub fn update_progress(
        storage: &Storage,
        goal_id: &str,
        progress: f32,
    ) -> anyhow::Result<PersonalGoalRecord> {
        let mut goal = storage
            .get_personal_goal(goal_id)?
            .ok_or_else(|| anyhow::anyhow!("Goal not found: {}", goal_id))?;

        let clamped = progress.clamp(0.0, 1.0);
        goal.progress = clamped;
        let now = chrono::Utc::now().to_rfc3339();
        goal.updated_at = now;

        if (clamped - 1.0).abs() < f32::EPSILON && goal.status == GoalStatus::Active.as_str() {
            goal.status = GoalStatus::Completed.as_str().to_string();
        }

        storage.upsert_personal_goal(&goal)?;
        Ok(goal)
    }

    /// 绑定或解绑活跃执行会话
    pub fn bind_session(
        storage: &Storage,
        goal_id: &str,
        session_id: Option<&str>,
    ) -> anyhow::Result<PersonalGoalRecord> {
        let mut goal = storage
            .get_personal_goal(goal_id)?
            .ok_or_else(|| anyhow::anyhow!("Goal not found: {}", goal_id))?;

        goal.active_session_id = session_id.map(|s| s.to_string());
        goal.updated_at = chrono::Utc::now().to_rfc3339();
        storage.upsert_personal_goal(&goal)?;
        Ok(goal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_goal_transitions() {
        assert!(GoalStatus::Draft.can_transition_to(GoalStatus::Active));
        assert!(GoalStatus::Active.can_transition_to(GoalStatus::Completed));
        assert!(!GoalStatus::Draft.can_transition_to(GoalStatus::Archived));
    }

    #[test]
    fn test_goal_manager_flow() {
        let storage = Storage::in_memory().unwrap();
        let goal = GoalManager::create_goal(
            &storage,
            "g-1",
            "Ship Personal OS",
            Some("Refactor all layers".into()),
            5,
            "user",
            vec!["do not break clippy".into()],
            vec!["ci is green".into()],
            None,
        )
        .unwrap();

        assert_eq!(goal.status, "active");
        assert_eq!(goal.progress, 0.0);

        // Progress update to 1.0 should auto-complete
        let finished = GoalManager::update_progress(&storage, "g-1", 1.0).unwrap();
        assert_eq!(finished.status, "completed");
        assert_eq!(finished.progress, 1.0);

        // Can transition to archived
        let archived = GoalManager::transition_status(&storage, "g-1", GoalStatus::Archived).unwrap();
        assert_eq!(archived.status, "archived");
    }
}
