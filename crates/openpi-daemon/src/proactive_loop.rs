//! 主动服务循环 (Proactive Loop)：EventBus 的消费者。
//!
//! 链路：`EventBus.subscribe()` → 去抖(不变量 6) → 熔断门禁(不变量 10)
//!      → `DecisionEngine::evaluate` → 落库 / 广播卡片 / 经网关执行。
//!
//! 同时驱动「每日晨报」节拍。

use std::collections::HashMap;
use std::time::{Duration, Instant};

use openpi_storage::{ActionCardRecord, PersonalMemoryRecord, Storage};
use serde_json::{json, Value};

use crate::decision::{DecisionAction, DecisionEngine};
use crate::event_bus::AgentEvent;
use crate::supervisor::Supervisor;

/// 每类事件的去抖窗口（秒）。
const DEBOUNCE_SECS: u64 = 5;
/// 循环等待粒度：既用于收事件，也用于驱动每日晨报节拍。
const TICK: Duration = Duration::from_secs(30);

/// 后台常驻的主动服务循环。
pub async fn run_proactive_loop(supervisor: Supervisor, storage: Storage) {
    tracing::info!("Starting Proactive Loop (event-driven) ...");
    let mut rx = supervisor.event_bus.subscribe();
    let mut debounce: HashMap<String, Instant> = HashMap::new();
    let mut last_briefing_date: Option<String> = None;

    loop {
        match tokio::time::timeout(TICK, rx.recv()).await {
            Ok(Ok(ev)) => handle_event(&supervisor, &storage, &mut debounce, ev).await,
            Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(n))) => {
                tracing::warn!("[proactive] event stream lagged, dropped {} events", n);
            }
            Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
            Err(_) => {} // timeout → 走到每日节拍
        }

        maybe_daily_briefing(&supervisor, &storage, &mut last_briefing_date);
    }
}

async fn handle_event(
    supervisor: &Supervisor,
    storage: &Storage,
    debounce: &mut HashMap<String, Instant>,
    ev: AgentEvent,
) {
    if !pass_debounce(debounce, &ev.event_type, DEBOUNCE_SECS) {
        return;
    }

    // 记录未提交目录，供晨报聚合使用（P0-3）
    if ev.event_type == "git_uncommitted" {
        record_uncommitted_dir(storage, &ev);
    }

    // 不变量 10：熔断 / 降级态下不产生任何自主行动
    if !supervisor.gateway.circuit_breaker.is_autonomous_action_allowed() {
        return;
    }

    match DecisionEngine::evaluate(&ev) {
        DecisionAction::Ignore { .. } => {}
        DecisionAction::Remember { category, content } => {
            let _ = storage.upsert_personal_memory(&memory_record(&category, &content, &ev));
        }
        DecisionAction::CardSuggestion {
            title,
            description,
            action_type,
            payload,
        } => {
            let card = persist_card(storage, &title, &description, &action_type, &payload);
            emit(supervisor, json!({ "type": "action_card", "card": card }));
        }
        DecisionAction::ExecuteProactive {
            task_name,
            objective,
        } => {
            spawn_via_gateway(supervisor, storage, &ev.event_type, &task_name, &objective);
        }
        DecisionAction::AskUser { question, choices } => {
            emit(
                supervisor,
                json!({ "type": "ask_user", "question": question, "choices": choices }),
            );
        }
    }
}

/// 同类事件在 `secs` 秒内只处理一次（不变量 6：事件洪峰去抖隔离）。
fn pass_debounce(debounce: &mut HashMap<String, Instant>, key: &str, secs: u64) -> bool {
    let now = Instant::now();
    if let Some(last) = debounce.get(key) {
        if now.duration_since(*last) < Duration::from_secs(secs) {
            return false;
        }
    }
    debounce.insert(key.to_string(), now);
    true
}

/// 通过系统通道 `"proactive"` 广播事件（`ipc.rs` 的白名单保证送达 UI）。
fn emit(supervisor: &Supervisor, event: Value) {
    let _ = supervisor.event_tx.send(("proactive".to_string(), event));
}

fn memory_record(category: &str, content: &str, ev: &AgentEvent) -> PersonalMemoryRecord {
    let now = chrono::Utc::now().to_rfc3339();
    PersonalMemoryRecord {
        id: format!("mem-{}", uuid::Uuid::new_v4()),
        category: category.to_string(),
        content: content.to_string(),
        source: ev.source.clone(),
        confidence: 0.7,
        importance: 0.5,
        access_count: 0,
        created_at: now.clone(),
        updated_at: now,
        last_accessed_at: None,
        expires_at: None,
        tags: vec!["proactive".to_string()],
        related_entities: vec![],
    }
}

/// 把事件里的 cwd 记入「未提交目录」KV，供每日晨报聚合（去重，最多保留 20 个）。
fn record_uncommitted_dir(storage: &Storage, ev: &AgentEvent) {
    let Some(cwd) = ev.payload.get("cwd").and_then(|v| v.as_str()) else {
        return;
    };
    if cwd.is_empty() {
        return;
    }
    let mut dirs: Vec<String> = storage
        .get_kv("proactive:uncommitted_dirs")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if !dirs.iter().any(|d| d == cwd) {
        dirs.push(cwd.to_string());
        if dirs.len() > 20 {
            dirs.remove(0);
        }
        if let Ok(json) = serde_json::to_string(&dirs) {
            let _ = storage.set_kv("proactive:uncommitted_dirs", &json);
        }
    }
}

/// 卡片的去重身份：只取「情境」字段（如目录），**不含会频繁变化的数字**。
///
/// 回归背景：此前用整个 payload 做摘要，而 GitPoller 每次轮询都会带上最新的
/// `changedFiles`（72 / 71 / 4 / 3 …），于是同一处未提交变更每分钟插一张新卡片，
/// 十几分钟就刷出一屏重复卡片。现在同一目录始终映射到同一张卡片。
fn card_identity(action_type: &str, payload: &Value) -> String {
    match action_type {
        "git_uncommitted" => payload
            .get("cwd")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        _ => payload.to_string(),
    }
}

/// 落库一张行动卡片，并返回给前端广播用的 JSON。
fn persist_card(
    storage: &Storage,
    title: &str,
    description: &str,
    action_type: &str,
    payload: &Value,
) -> Value {
    let now = chrono::Utc::now().to_rfc3339();
    // 稳定 id：同一 action_type + 同一情境反复出现时**原地更新**，而非刷屏
    let digest = stable_digest(&Value::String(card_identity(action_type, payload)));
    let id = format!("card-{}-{}", action_type, digest);
    let summary = summarize_card(action_type, description, payload);

    let rec = ActionCardRecord {
        id: id.clone(),
        title: title.to_string(),
        summary: summary.clone(),
        action_type: action_type.to_string(),
        payload: serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_string()),
        status: "open".to_string(),
        created_at: now.clone(),
    };
    let _ = storage.upsert_action_card(&rec);

    json!({
        "id": id,
        "title": title,
        "summary": summary,
        "actionType": action_type,
        "payload": payload,
        "status": "open",
        "createdAt": now,
    })
}

/// 把决策引擎给出的原始 payload 描述转成人类可读的卡片摘要。
fn summarize_card(action_type: &str, fallback: &str, payload: &Value) -> String {
    match action_type {
        "git_uncommitted" => {
            let n = payload
                .get("changedFiles")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            format!("检测到 {} 个文件有未提交改动，建议审查后再继续", n)
        }
        "timer_expired" => "定时检查提醒".to_string(),
        _ => fallback.to_string(),
    }
}

/// 由 JSON 载荷计算一个稳定的短摘要（用于卡片去重）。
fn stable_digest(value: &Value) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    value.to_string().hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// 经统一执行网关发起一次「个人层主动」执行（受权限 / 预算 / 熔断约束）。
fn spawn_via_gateway(
    supervisor: &Supervisor,
    storage: &Storage,
    event_type: &str,
    task_name: &str,
    objective: &str,
) {
    let supervisor = supervisor.clone();
    let storage = storage.clone();
    let task_name = task_name.to_string();
    let objective = objective.to_string();
    let event_type = event_type.to_string();
    tokio::spawn(async move {
        let req = crate::gateway::PersonalExecutionRequest {
            goal_id: None,
            action: format!("proactive:{}", task_name),
            priority: "normal".to_string(),
            context: objective,
            permission: "read_only".to_string(),
            is_read_only: true,
            has_user_confirmation: false,
            estimated_tokens: 2000,
            constraint: openpi_safety::circuit_breaker::ExecutionConstraint::default(),
        };
        match supervisor.gateway.execute(req).await {
            Ok(res) => {
                tracing::info!(
                    "[proactive] gateway executed {} for {} ({} tokens, {}ms)",
                    task_name,
                    event_type,
                    res.tokens_used,
                    res.duration_ms
                );
                let _ = storage.set_kv("proactive:last_execution", &res.message);
            }
            Err(e) => tracing::warn!("[proactive] gateway rejected {}: {}", task_name, e),
        }
    });
}

/// 每日晨报节拍：>= 08:00 且当天尚未生成时，生成并广播一次。
fn maybe_daily_briefing(supervisor: &Supervisor, storage: &Storage, last: &mut Option<String>) {
    let now = chrono::Local::now();
    let today = now.format("%Y-%m-%d").to_string();
    if last.as_deref() == Some(today.as_str()) {
        return;
    }
    let hour = now.format("%H").to_string().parse::<u32>().unwrap_or(0);
    if hour < 8 {
        return;
    }
    if let Ok(briefing) = crate::proactive::ProactiveEngine::generate_briefing(storage) {
        emit(
            supervisor,
            json!({ "type": "today_briefing", "briefing": briefing }),
        );
        tracing::info!("[proactive] daily briefing generated for {}", today);
    }
    *last = Some(today);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(event_type: &str, importance: f32) -> AgentEvent {
        AgentEvent {
            id: "e".into(),
            event_type: event_type.into(),
            timestamp: 0,
            source: "test".into(),
            payload: json!({ "cwd": "/repo", "changedFiles": 3 }),
            importance,
        }
    }

    #[test]
    fn debounce_suppresses_repeats() {
        let mut d = HashMap::new();
        assert!(pass_debounce(&mut d, "git_uncommitted", 60));
        assert!(!pass_debounce(&mut d, "git_uncommitted", 60));
        assert!(pass_debounce(&mut d, "file_changed", 60));
    }

    #[test]
    fn card_id_is_stable_for_same_payload() {
        let p = json!({ "cwd": "/repo", "changedFiles": 3 });
        assert_eq!(stable_digest(&p), stable_digest(&p.clone()));
    }

    #[test]
    fn card_identity_ignores_volatile_file_count() {
        // 关键回归：文件数变化不能产生新卡片，否则每次 Git 轮询都刷一张。
        let a = card_identity("git_uncommitted", &json!({ "cwd": "/repo", "changedFiles": 72 }));
        let b = card_identity("git_uncommitted", &json!({ "cwd": "/repo", "changedFiles": 3 }));
        assert_eq!(a, b);
        // 不同目录仍然是不同的卡片。
        let c = card_identity("git_uncommitted", &json!({ "cwd": "/other", "changedFiles": 3 }));
        assert_ne!(a, c);
        // 未知 action_type 保持整体 payload 语义（不做激进合并）。
        assert_ne!(
            card_identity("timer_expired", &json!({ "at": 1 })),
            card_identity("timer_expired", &json!({ "at": 2 }))
        );
    }

    #[test]
    fn git_uncommitted_maps_to_card() {
        // 关键回归：真实的未提交变更必须能产出低打扰卡片，而不是被静默忽略。
        let action = DecisionEngine::evaluate(&ev("git_uncommitted", 0.8));
        assert!(matches!(action, DecisionAction::CardSuggestion { .. }));
    }

    #[test]
    fn file_changed_is_silent() {
        let action = DecisionEngine::evaluate(&ev("file_changed", 0.4));
        assert!(matches!(action, DecisionAction::Ignore { .. }));
    }

    #[test]
    fn heartbeat_is_silent() {
        // 关键回归：心跳绝不能产生记忆写入 / 卡片（否则每分钟写一条记忆）
        let action = DecisionEngine::evaluate(&ev("timer_expired", 0.3));
        assert!(matches!(action, DecisionAction::Ignore { .. }));
    }

    #[test]
    fn uncommitted_dir_is_recorded_once() {
        let storage = Storage::in_memory().unwrap();
        let e = ev("git_uncommitted", 0.8);
        record_uncommitted_dir(&storage, &e);
        record_uncommitted_dir(&storage, &e);
        let dirs: Vec<String> = storage
            .get_kv("proactive:uncommitted_dirs")
            .unwrap()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        assert_eq!(dirs, vec!["/repo".to_string()]);
    }
}

