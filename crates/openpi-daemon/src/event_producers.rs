//! 事件生产者 (Event Producers)：把真实系统信号灌入 EventBus。
//!
//! 设计原则：
//! 1. **只负责 `publish`**，不含任何业务判断（判断在 `proactive_loop` 里做）。
//! 2. 一切高频信号都必须去抖（对应不变量 6：事件洪峰去抖隔离）。
//! 3. 全部失败都只记日志，绝不让监听器拖垮 daemon。
//!
//! 产出的四类事件：
//! - `file_changed`     活跃工作区文件变动（去抖 1.5s）
//! - `git_uncommitted`  活跃工作区存在未提交变更（状态哈希去重）
//! - `timer_expired`    心跳节拍（60s）

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use notify::{RecursiveMode, Watcher};
use serde_json::json;

use crate::event_bus::{AgentEvent, EventBus};
use crate::supervisor::Supervisor;

/// 需要忽略的噪音目录（构建产物 / 依赖 / VCS 元数据）。
const IGNORED_DIRS: [&str; 5] = ["target", "node_modules", ".git", "dist", ".next"];

/// 文件变动去抖窗口。
const FILE_DEBOUNCE: Duration = Duration::from_millis(1500);

type SharedCwds = Arc<Mutex<HashSet<PathBuf>>>;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn publish(
    bus: &EventBus,
    event_type: &str,
    source: &str,
    importance: f32,
    payload: serde_json::Value,
) {
    let _ = bus.publish(AgentEvent {
        id: format!("evt-{}", uuid::Uuid::new_v4()),
        event_type: event_type.to_string(),
        timestamp: now_ms(),
        source: source.to_string(),
        payload,
        importance,
    });
}

/// 路径是否落在被忽略的目录内（纯函数，可单测）。
pub fn is_ignored_path(path: &Path) -> bool {
    path.components().any(|c| {
        c.as_os_str()
            .to_str()
            .map(|s| IGNORED_DIRS.contains(&s))
            .unwrap_or(false)
    })
}

/// 找到某个变动路径所属的被监听工作区（用于去抖分组）。
fn owning_cwd(watched: &HashSet<PathBuf>, path: &Path) -> PathBuf {
    watched
        .iter()
        .find(|root| path.starts_with(root))
        .cloned()
        .unwrap_or_else(|| path.parent().map(|p| p.to_path_buf()).unwrap_or_default())
}

/// 启动全部事件生产者。
pub fn spawn_all(bus: Arc<EventBus>, supervisor: Supervisor) {
    let cwds: SharedCwds = Arc::new(Mutex::new(HashSet::new()));

    spawn_cwd_refresher(supervisor.clone(), cwds.clone());
    spawn_session_idle(supervisor, bus.clone());
    spawn_heartbeat(bus.clone());
    spawn_git_poller(bus.clone(), cwds.clone());
    spawn_file_watcher(bus, cwds);
}

/// 每 30s 检查会话空闲状态：从「有会话在跑」变为「全部空闲」时发一次 `session_idle`。
fn spawn_session_idle(supervisor: Supervisor, bus: Arc<EventBus>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        let mut was_active = false;
        loop {
            interval.tick().await;
            let sessions = supervisor.list_sessions().await;
            let has_sessions = !sessions.is_empty();
            let any_running = sessions.iter().any(|s| s.running);
            // 只在「活跃 → 空闲」的边沿触发一次，避免刷屏
            if was_active && !any_running && has_sessions {
                publish(
                    &bus,
                    "session_idle",
                    "session_monitor",
                    0.3,
                    json!({ "sessions": sessions.len() }),
                );
            }
            was_active = any_running;
        }
    });
}

/// 每 30s 从 supervisor 拉取活跃工作区目录，供 git 轮询与文件监听使用。
fn spawn_cwd_refresher(supervisor: Supervisor, cwds: SharedCwds) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            let sessions = supervisor.list_sessions().await;
            let mut next = HashSet::new();
            for s in sessions {
                let p = PathBuf::from(&s.cwd);
                if p.exists() && !is_ignored_path(&p) {
                    next.insert(p);
                }
            }
            if let Ok(mut guard) = cwds.lock() {
                *guard = next;
            }
        }
    });
}

/// 每 60s 发一次心跳 `timer_expired`。
///
/// 重要性刻意压到 0.3 —— 决策引擎对 `timer_expired` 的 ActionScore 会落在
/// `Ignore` 区间，因此心跳**不会**产生记忆写入或卡片（否则每 60s 写一条记忆）。
/// 它的作用是给未来的订阅者一个节拍信号。
fn spawn_heartbeat(bus: Arc<EventBus>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            publish(
                &bus,
                "timer_expired",
                "heartbeat",
                0.3,
                json!({ "tick": now_ms() }),
            );
        }
    });
}

/// 每 30s 轮询活跃工作区的 git 状态，发现未提交变更时发 `git_uncommitted`。
fn spawn_git_poller(bus: Arc<EventBus>, cwds: SharedCwds) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        let mut last_state: HashMap<PathBuf, String> = HashMap::new();
        loop {
            interval.tick().await;
            let dirs: Vec<PathBuf> = cwds
                .lock()
                .map(|g| g.iter().cloned().collect())
                .unwrap_or_default();
            for dir in dirs {
                let Some(status) = git_status_porcelain(&dir).await else {
                    continue;
                };
                if status.trim().is_empty() {
                    last_state.remove(&dir);
                    continue;
                }
                // 状态未变则不重复打扰
                if last_state.get(&dir).map(|s| s == &status).unwrap_or(false) {
                    continue;
                }
                let changed_files = status.lines().count();
                last_state.insert(dir.clone(), status);
                publish(
                    &bus,
                    "git_uncommitted",
                    "git_poller",
                    0.8,
                    json!({
                        "cwd": dir.to_string_lossy(),
                        "changedFiles": changed_files,
                    }),
                );
            }
        }
    });
}

async fn git_status_porcelain(dir: &Path) -> Option<String> {
    let out = tokio::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["status", "--porcelain"])
        .output()
        .await
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 文件监听：活跃工作区文件变动时发 `file_changed`（去抖 1.5s）。
///
/// `notify` 的回调是同步的，因此整个监听循环跑在 blocking 线程里；
/// 每 500ms 醒来一次以同步 watch 集合到当前活跃工作区。
fn spawn_file_watcher(bus: Arc<EventBus>, cwds: SharedCwds) {
    tokio::task::spawn_blocking(move || {
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = match notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        }) {
            Ok(w) => w,
            Err(e) => {
                tracing::warn!("[event_producers] file watcher init failed: {}", e);
                return;
            }
        };

        let mut watched: HashSet<PathBuf> = HashSet::new();
        let mut last_emit: HashMap<PathBuf, Instant> = HashMap::new();

        loop {
            // 1) 同步 watch 集合到当前活跃工作区
            let current: HashSet<PathBuf> = cwds.lock().map(|g| g.clone()).unwrap_or_default();
            for p in current.difference(&watched) {
                if p.exists() {
                    if let Err(e) = watcher.watch(p, RecursiveMode::Recursive) {
                        tracing::warn!("[event_producers] watch {} failed: {}", p.display(), e);
                    }
                }
            }
            for p in watched.difference(&current) {
                let _ = watcher.unwatch(p);
            }
            watched = current;

            // 2) 收事件（超时用于周期性同步 watch 集合）
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(Ok(ev)) => {
                    for path in ev.paths {
                        if is_ignored_path(&path) {
                            continue;
                        }
                        let root = owning_cwd(&watched, &path);
                        let now = Instant::now();
                        if let Some(last) = last_emit.get(&root) {
                            if now.duration_since(*last) < FILE_DEBOUNCE {
                                continue;
                            }
                        }
                        last_emit.insert(root.clone(), now);
                        publish(
                            &bus,
                            "file_changed",
                            "file_watcher",
                            0.4,
                            json!({
                                "path": path.to_string_lossy(),
                                "cwd": root.to_string_lossy(),
                            }),
                        );
                    }
                }
                Ok(Err(e)) => tracing::warn!("[event_producers] watch error: {}", e),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignored_paths_are_filtered() {
        assert!(is_ignored_path(Path::new("/repo/target/debug/foo")));
        assert!(is_ignored_path(Path::new("/repo/node_modules/pkg/index.js")));
        assert!(is_ignored_path(Path::new("/repo/.git/HEAD")));
        assert!(!is_ignored_path(Path::new("/repo/src/main.rs")));
        assert!(!is_ignored_path(Path::new("/repo/README.md")));
    }

    #[test]
    fn owning_cwd_matches_a_root() {
        let mut watched = HashSet::new();
        watched.insert(PathBuf::from("/repo/a"));
        let owner = owning_cwd(&watched, Path::new("/repo/a/src/main.rs"));
        assert_eq!(owner, PathBuf::from("/repo/a"));
    }
}

