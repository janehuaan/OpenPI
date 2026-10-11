//! 学习防污染与归因层 (Learning Anti-Pollution & Attribution Layer)
//!
//! 核心原则：
//! 1. "用户修改了结果" != "用户偏好改变"。
//! 2. 归因分流：
//!    - Preference Change (用户行为范式调整) -> 进入偏好候选
//!    - Requirement Change (本次任务边界临时变更) -> 仅影响当前项目/会话
//!    - Bug / Error (生成结果存在缺陷) -> 沉淀反思教训 (Experience)
//! 3. 偏好支持版本化溯源与原子化 Rollback ("学错了可撤回")。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AttributionError {
    #[error("偏好记录未找到: {0}")]
    NotFound(String),
    #[error("偏好已被回滚或弃用: {0}")]
    AlreadyInactive(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttributionCategory {
    /// 用户行为范式调整 (偏好晋升)
    PreferenceChange,
    /// 本次任务边界临时变更 (不影响全局偏好)
    RequirementChange,
    /// 生成结果缺陷或 Bug (沉淀反思经验)
    BugOrError,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreferenceScope {
    Global,
    Project,
    Session,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreferenceSource {
    ExplicitCommand,
    RepeatedDecisions,
    Inferred,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreferenceStatus {
    Active,
    Deprecated,
    RolledBack,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRef {
    pub session_id: String,
    pub commit_sha: Option<String>,
    pub turn_index: Option<u32>,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPreferenceRecord {
    pub id: String,
    pub version: u32,
    pub key: String,
    pub value: serde_json::Value,
    pub scope: PreferenceScope,
    pub confidence: f32, // 0.0 ~ 1.0
    pub source: PreferenceSource,
    pub evidence: Vec<EvidenceRef>,
    pub created_at: i64,
    pub updated_at: i64,
    pub expires_at: Option<i64>,
    pub supersedes: Option<String>,
    pub status: PreferenceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertPreferenceInput {
    pub key: String,
    pub value: serde_json::Value,
    pub scope: PreferenceScope,
    pub confidence: f32,
    pub source: PreferenceSource,
    pub evidence: Vec<EvidenceRef>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Default)]
struct PreferenceStore {
    records_by_id: HashMap<String, UserPreferenceRecord>,
    records_by_key: HashMap<String, Vec<String>>, // key -> Vec<id> 按时间/版本排序
}

#[derive(Debug, Clone, Default)]
pub struct PreferenceManager {
    store: Arc<RwLock<PreferenceStore>>,
}

impl PreferenceManager {
    pub fn new() -> Self {
        Self {
            store: Arc::new(RwLock::new(PreferenceStore::default())),
        }
    }

    /// 归因分类器：依据用户反馈/修改文本与情境判定归因方向
    pub fn attribute_reaction(
        feedback_text: &str,
        is_repetitive: bool,
    ) -> AttributionCategory {
        let lower = feedback_text.to_lowercase();
        if lower.contains("bug") || lower.contains("报错") || lower.contains("崩溃") || lower.contains("失败") || lower.contains("fix") {
            AttributionCategory::BugOrError
        } else if lower.contains("以后") || lower.contains("始终") || lower.contains("默认") || lower.contains("总是") || lower.contains("习惯") || is_repetitive {
            AttributionCategory::PreferenceChange
        } else {
            // 常规单次改动默认归入需求临时变更
            AttributionCategory::RequirementChange
        }
    }

    /// 插入或更新偏好（自动版本递增与溯源串联）
    pub fn upsert_preference(&self, input: UpsertPreferenceInput) -> UserPreferenceRecord {
        let mut store = self.store.write().unwrap();
        let now = chrono::Utc::now().timestamp_millis();

        // 查找该 key 的前一版本
        let prev_record = store.records_by_key.get(&input.key).and_then(|ids| {
            ids.last().and_then(|id| store.records_by_id.get(id))
        });

        let (new_version, supersedes) = match prev_record {
            Some(prev) => (prev.version + 1, Some(prev.id.clone())),
            None => (1, None),
        };

        // 如果存在前一版本，将其置为 Deprecated
        if let Some(ref prev_id) = supersedes {
            if let Some(prev_entry) = store.records_by_id.get_mut(prev_id) {
                if prev_entry.status == PreferenceStatus::Active {
                    prev_entry.status = PreferenceStatus::Deprecated;
                    prev_entry.updated_at = now;
                }
            }
        }

        let id = format!("pref_{}_{}", input.key, uuid::Uuid::new_v4().simple());
        let record = UserPreferenceRecord {
            id: id.clone(),
            version: new_version,
            key: input.key.clone(),
            value: input.value,
            scope: input.scope,
            confidence: input.confidence.clamp(0.0, 1.0),
            source: input.source,
            evidence: input.evidence,
            created_at: now,
            updated_at: now,
            expires_at: input.expires_at,
            supersedes,
            status: PreferenceStatus::Active,
        };

        store.records_by_id.insert(id.clone(), record.clone());
        store
            .records_by_key
            .entry(input.key)
            .or_default()
            .push(id);

        record
    }

    /// 原子化回滚偏好 (Rollback API)
    /// 将目标偏好标记为 RolledBack，并尝试恢复其前置版本
    pub fn rollback_preference(&self, id: &str) -> Result<Option<UserPreferenceRecord>, AttributionError> {
        let mut store = self.store.write().unwrap();
        let now = chrono::Utc::now().timestamp_millis();

        let (key, supersedes) = {
            let record = store
                .records_by_id
                .get_mut(id)
                .ok_or_else(|| AttributionError::NotFound(id.to_string()))?;

            if record.status == PreferenceStatus::RolledBack {
                return Err(AttributionError::AlreadyInactive(id.to_string()));
            }

            record.status = PreferenceStatus::RolledBack;
            record.updated_at = now;
            (record.key.clone(), record.supersedes.clone())
        };

        // 若存在旧版本，将其恢复为 Active
        let restored = if let Some(prev_id) = supersedes {
            if let Some(prev_rec) = store.records_by_id.get_mut(&prev_id) {
                prev_rec.status = PreferenceStatus::Active;
                prev_rec.updated_at = now;
                Some(prev_rec.clone())
            } else {
                None
            }
        } else {
            None
        };

        // 清理当前 key 的活跃序列
        let _ = key;
        Ok(restored)
    }

    /// 获取所有当前生效的偏好
    pub fn list_active(&self) -> Vec<UserPreferenceRecord> {
        let store = self.store.read().unwrap();
        let now = chrono::Utc::now().timestamp_millis();

        store
            .records_by_id
            .values()
            .filter(|r| {
                if r.status != PreferenceStatus::Active {
                    return false;
                }
                if let Some(exp) = r.expires_at {
                    if exp <= now {
                        return false;
                    }
                }
                true
            })
            .cloned()
            .collect()
    }

    /// 获取某个 key 的历史版本流
    pub fn get_history(&self, key: &str) -> Vec<UserPreferenceRecord> {
        let store = self.store.read().unwrap();
        if let Some(ids) = store.records_by_key.get(key) {
            ids.iter()
                .filter_map(|id| store.records_by_id.get(id).cloned())
                .collect()
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_attribution_classifier() {
        assert_eq!(
            PreferenceManager::attribute_reaction("这里的代码有 bug 导致 panic", false),
            AttributionCategory::BugOrError
        );
        assert_eq!(
            PreferenceManager::attribute_reaction("以后所有前端组件都用 Tailwind", false),
            AttributionCategory::PreferenceChange
        );
        assert_eq!(
            PreferenceManager::attribute_reaction("把这个按钮改成蓝色", false),
            AttributionCategory::RequirementChange
        );
    }

    #[test]
    fn test_preference_versioning_and_rollback() {
        let mgr = PreferenceManager::new();
        let evidence = vec![EvidenceRef {
            session_id: "s1".into(),
            commit_sha: None,
            turn_index: Some(1),
            snippet: "Prefer rustfmt".into(),
        }];

        // v1
        let v1 = mgr.upsert_preference(UpsertPreferenceInput {
            key: "formatter".into(),
            value: serde_json::json!("rustfmt"),
            scope: PreferenceScope::Global,
            confidence: 0.9,
            source: PreferenceSource::ExplicitCommand,
            evidence: evidence.clone(),
            expires_at: None,
        });
        assert_eq!(v1.version, 1);
        assert_eq!(v1.status, PreferenceStatus::Active);

        // v2 (覆盖 v1)
        let v2 = mgr.upsert_preference(UpsertPreferenceInput {
            key: "formatter".into(),
            value: serde_json::json!("prettier"),
            scope: PreferenceScope::Global,
            confidence: 0.8,
            source: PreferenceSource::ExplicitCommand,
            evidence,
            expires_at: None,
        });
        assert_eq!(v2.version, 2);
        assert_eq!(v2.supersedes, Some(v1.id.clone()));

        // 验证当前生效的是 v2
        let active = mgr.list_active();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, v2.id);
        assert_eq!(active[0].value, serde_json::json!("prettier"));

        // 回滚 v2 -> 自动恢复 v1
        let restored = mgr.rollback_preference(&v2.id).unwrap().unwrap();
        assert_eq!(restored.id, v1.id);
        assert_eq!(restored.status, PreferenceStatus::Active);

        let active_after_rollback = mgr.list_active();
        assert_eq!(active_after_rollback.len(), 1);
        assert_eq!(active_after_rollback[0].id, v1.id);
        assert_eq!(active_after_rollback[0].value, serde_json::json!("rustfmt"));
    }
}
