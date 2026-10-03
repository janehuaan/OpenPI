//! Cloud data sync (phase 1).
//!
//! Mirrors the local SQLite tables `key_values` (only the `profile` key),
//! `tasks` and `task_runs` to Supabase via PostgREST + RLS.
//!
//! Auth model: the renderer owns the Supabase session (it handles refresh-token
//! rotation); it pushes the current `access_token` here. This module NEVER
//! refreshes tokens — on 401 it just records `auth_required` and waits for the
//! renderer to refresh and re-push.

use std::sync::Arc;

use anyhow::{anyhow, Result};
use openpi_storage::{Storage, TaskRecord, TaskRunRecord};
use serde_json::{json, Value};
use tokio::sync::RwLock;
use tracing::{info, warn};

const KV_TABLE: &str = "cloud_kv";
const TASKS_TABLE: &str = "cloud_tasks";
const RUNS_TABLE: &str = "cloud_task_runs";
const FILES_TABLE: &str = "cloud_files";

/// Only these `key_values` keys are ever pushed to the cloud (phase 1).
const KV_ALLOWLIST: &[&str] = &["profile"];

const SYNC_INTERVAL_SECS: u64 = 60;

#[derive(Clone, Debug)]
pub struct CloudAuth {
    pub url: String,
    pub anon_key: String,
    pub access_token: String,
    pub expires_at: i64,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    pub configured: bool,
    pub signed_in: bool,
    pub auth_required: bool,
    pub last_sync_at: Option<String>,
    pub last_error: Option<String>,
    pub pushed: u64,
    pub pulled: u64,
}

#[derive(Clone)]
pub struct CloudSync {
    http: reqwest::Client,
    storage: Storage,
    auth: Arc<RwLock<Option<CloudAuth>>>,
    status: Arc<RwLock<CloudStatus>>,
    lock: Arc<tokio::sync::Mutex<()>>,
}

impl CloudSync {
    pub fn new(storage: Storage) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .expect("cloud http client"),
            storage,
            auth: Arc::new(RwLock::new(None)),
            status: Arc::new(RwLock::new(CloudStatus::default())),
            lock: Arc::new(tokio::sync::Mutex::new(())),
        }
    }

    pub async fn set_auth(&self, auth: CloudAuth) {
        *self.auth.write().await = Some(auth);
        let mut s = self.status.write().await;
        s.configured = true;
        s.signed_in = true;
        s.auth_required = false;
        s.last_error = None;
    }

    pub async fn clear_auth(&self) {
        *self.auth.write().await = None;
        let mut s = self.status.write().await;
        s.signed_in = false;
    }

    pub async fn is_signed_in(&self) -> bool {
        self.auth.read().await.is_some()
    }

    pub async fn status(&self) -> CloudStatus {
        self.status.read().await.clone()
    }

    /// Record a local deletion so it propagates on the next push.
    pub fn tombstone(&self, table: &str, id: &str) {
        let _ = self
            .storage
            .set_kv(&format!("cloud:tomb:{}:{}", table, id), &now_iso());
    }

    pub async fn sync_now(&self) -> Result<CloudStatus> {
        let _guard = self.lock.lock().await; // serialize syncs

        let auth = match self.auth.read().await.clone() {
            Some(a) => a,
            None => return Ok(self.status().await),
        };

        let mut pushed = 0u64;
        let mut pulled = 0u64;
        let mut first_err: Option<String> = None;
        let mut auth_required = false;

        macro_rules! step {
            ($e:expr) => {
                match $e {
                    Ok((p, l)) => {
                        pushed += p;
                        pulled += l;
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        if msg.contains("401") || msg.contains("auth_required") {
                            auth_required = true;
                        }
                        if first_err.is_none() {
                            first_err = Some(msg);
                        }
                    }
                }
            };
        }

        // key_values (allowlisted)
        step!(self.sync_kv(&auth).await);
        // tasks
        step!(self.sync_tasks(&auth).await);
        // task runs
        step!(self.sync_runs(&auth).await);
        // files: memories / skills / preferences
        step!(self.sync_files(&auth).await);
        // local deletions
        step!(self.push_tombstones(&auth).await);

        let mut s = self.status.write().await;
        s.configured = true;
        s.signed_in = true;
        s.auth_required = auth_required;
        s.pushed = pushed;
        s.pulled = pulled;
        s.last_sync_at = Some(now_iso());
        s.last_error = first_err;
        Ok(s.clone())
    }

    // ── key_values ──────────────────────────────────────────────
    async fn sync_kv(&self, auth: &CloudAuth) -> Result<(u64, u64)> {
        let wm = self.wm("push", KV_TABLE);
        let mut rows = Vec::new();
        for rec in self.storage.list_kv()? {
            if !KV_ALLOWLIST.contains(&rec.key.as_str()) {
                continue;
            }
            if !newer(&rec.updated_at, &wm) {
                continue;
            }
            rows.push(json!({
                "id": rec.key,
                "value": rec.value,
                "updated_at": to_iso(&rec.updated_at),
            }));
        }
        let pushed = self.push_rows(auth, KV_TABLE, "user_id,id", &rows).await?;
        if pushed > 0 || rows.is_empty() {
            if let Some(last) = rows.last().and_then(|r| r["updated_at"].as_str()) {
                let _ = self.set_wm("push", KV_TABLE, last);
            }
        }

        let pulled = self
            .pull_rows(auth, "pull", KV_TABLE, |row| {
                let id = row["id"].as_str().unwrap_or_default().to_string();
                if id.is_empty() || !KV_ALLOWLIST.contains(&id.as_str()) {
                    return Ok(false);
                }
                if let Some(del) = row["deleted_at"].as_str() {
                    if !del.is_empty() {
                        let _ = self.storage.set_kv(&id, "");
                        return Ok(true);
                    }
                }
                let value = row["value"].as_str().unwrap_or_default();
                let updated = row["updated_at"].as_str().unwrap_or_default();
                let local = self
                    .storage
                    .get_kv(&id)?
                    .map(|_| self.local_kv_updated(&id))
                    .unwrap_or_default();
                if newer(updated, &local) {
                    self.storage.upsert_kv_raw(&id, value, updated)?;
                    return Ok(true);
                }
                Ok(false)
            })
            .await?;
        Ok((pushed, pulled))
    }

    fn local_kv_updated(&self, key: &str) -> String {
        self.storage
            .list_kv()
            .ok()
            .and_then(|v| v.into_iter().find(|r| r.key == key).map(|r| r.updated_at))
            .unwrap_or_default()
    }

    // ── tasks ───────────────────────────────────────────────────
    async fn sync_tasks(&self, auth: &CloudAuth) -> Result<(u64, u64)> {
        let wm = self.wm("push", TASKS_TABLE);
        let mut rows = Vec::new();
        for t in self.storage.list_tasks()? {
            if !newer(&t.updated_at, &wm) {
                continue;
            }
            rows.push(task_to_json(&t));
        }
        let pushed = self.push_rows(auth, TASKS_TABLE, "user_id,id", &rows).await?;
        if let Some(last) = rows.last().and_then(|r| r["updated_at"].as_str()) {
            let _ = self.set_wm("push", TASKS_TABLE, last);
        }

        let pulled = self
            .pull_rows(auth, "pull", TASKS_TABLE, |row| {
                let id = row["id"].as_str().unwrap_or_default().to_string();
                if id.is_empty() {
                    return Ok(false);
                }
                if let Some(del) = row["deleted_at"].as_str() {
                    if !del.is_empty() {
                        let _ = self.storage.delete_task(&id);
                        return Ok(true);
                    }
                }
                let updated = row["updated_at"].as_str().unwrap_or_default();
                let local = self
                    .storage
                    .get_task(&id)?
                    .map(|t| t.updated_at)
                    .unwrap_or_default();
                if newer(updated, &local) {
                    self.storage.upsert_task_raw(&task_from_json(row))?;
                    return Ok(true);
                }
                Ok(false)
            })
            .await?;
        Ok((pushed, pulled))
    }

    // ── task runs ───────────────────────────────────────────────
    async fn sync_runs(&self, auth: &CloudAuth) -> Result<(u64, u64)> {
        let wm = self.wm("push", RUNS_TABLE);
        let mut rows = Vec::new();
        let mut newest = wm.clone();
        for r in self.storage.list_all_runs()? {
            let ts = run_ts(&r);
            if !newer(&ts, &wm) {
                continue;
            }
            if newer(&ts, &newest) {
                newest = ts.clone();
            }
            rows.push(run_to_json(&r, &ts));
        }
        let pushed = self.push_rows(auth, RUNS_TABLE, "user_id,id", &rows).await?;
        if newest != wm {
            let _ = self.set_wm("push", RUNS_TABLE, &newest);
        }

        let pulled = self
            .pull_rows(auth, "pull", RUNS_TABLE, |row| {
                let id = row["id"].as_str().unwrap_or_default().to_string();
                if id.is_empty() {
                    return Ok(false);
                }
                let updated = row["updated_at"].as_str().unwrap_or_default();
                if !newer(updated, &wm) {
                    return Ok(false);
                }
                self.storage.upsert_run_raw(&run_from_json(row))?;
                Ok(true)
            })
            .await?;
        Ok((pushed, pulled))
    }

    // ── tombstone deletes ───────────────────────────────────────
    async fn push_tombstones(&self, auth: &CloudAuth) -> Result<(u64, u64)> {
        let mut done = 0u64;
        for rec in self.storage.list_kv()? {
            let Some(rest) = rec.key.strip_prefix("cloud:tomb:") else {
                continue;
            };
            let rest = rest.to_string();
            let Some((table, id)) = rest.split_once(':') else {
                continue;
            };
            let url = format!(
                "{}/rest/v1/{}?id=eq.{}",
                base_url(auth),
                table,
                urlencoding(id)
            );
            let res = self
                .http
                .patch(url)
                .header("apikey", &auth.anon_key)
                .header("Authorization", format!("Bearer {}", auth.access_token))
                .header("Content-Type", "application/json")
                .header("Prefer", "return=minimal")
                .json(&json!({ "deleted_at": rec.value }))
                .send()
                .await?;
            if res.status().is_success() {
                let _ = self.storage.set_kv(&rec.key, "");
                done += 1;
            } else if res.status().as_u16() == 401 {
                return Err(anyhow!("401 auth_required"));
            }
        }
        Ok((done, 0))
    }

    // ── primitives ──────────────────────────────────────────────
    async fn push_rows(
        &self,
        auth: &CloudAuth,
        table: &str,
        on_conflict: &str,
        rows: &[Value],
    ) -> Result<u64> {
        if rows.is_empty() {
            return Ok(0);
        }
        let url = format!(
            "{}/rest/v1/{}?on_conflict={}",
            base_url(auth),
            table,
            on_conflict
        );
        let res = self
            .http
            .post(url)
            .header("apikey", &auth.anon_key)
            .header("Authorization", format!("Bearer {}", auth.access_token))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates,return=minimal")
            .json(rows)
            .send()
            .await?;
        let status = res.status();
        if status.is_success() {
            Ok(rows.len() as u64)
        } else if status.as_u16() == 401 {
            Err(anyhow!("401 auth_required"))
        } else {
            let body = res.text().await.unwrap_or_default();
            Err(anyhow!("push {} failed: {} {}", table, status, body))
        }
    }

    async fn pull_rows<F>(
        &self,
        auth: &CloudAuth,
        wm_prefix: &str,
        table: &str,
        mut apply: F,
    ) -> Result<u64>
    where
        F: FnMut(&Value) -> Result<bool>,
    {
        let wm = self.wm(wm_prefix, table);
        let mut url = format!(
            "{}/rest/v1/{}?select=*&order=updated_at.asc&limit=500",
            base_url(auth),
            table
        );
        if !wm.is_empty() {
            url.push_str(&format!("&updated_at=gt.{}", urlencoding(&to_iso(&wm))));
        }
        let res = self
            .http
            .get(url)
            .header("apikey", &auth.anon_key)
            .header("Authorization", format!("Bearer {}", auth.access_token))
            .send()
            .await?;
        let status = res.status();
        if status.as_u16() == 401 {
            return Err(anyhow!("401 auth_required"));
        }
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(anyhow!("pull {} failed: {} {}", table, status, body));
        }
        let rows: Vec<Value> = res.json().await.unwrap_or_default();
        let mut applied = 0u64;
        let mut max_ts = wm.clone();
        for row in &rows {
            if let Some(ts) = row["updated_at"].as_str() {
                if newer(ts, &max_ts) {
                    max_ts = ts.to_string();
                }
            }
            if apply(row).unwrap_or(false) {
                applied += 1;
            }
        }
        if max_ts != wm {
            let _ = self.set_wm(wm_prefix, table, &max_ts);
        }
        Ok(applied)
    }

    fn wm(&self, prefix: &str, table: &str) -> String {
        self.storage
            .get_kv(&format!("cloud:wm:{}:{}", prefix, table))
            .ok()
            .flatten()
            .unwrap_or_default()
    }

    fn set_wm(&self, prefix: &str, table: &str, ts: &str) -> Result<()> {
        self.storage
            .set_kv(&format!("cloud:wm:{}:{}", prefix, table), ts)
    }

    // ── files: memories / skills / preferences ──────────────────
    async fn sync_files(&self, auth: &CloudAuth) -> Result<(u64, u64)> {
        let root = openpi_root();
        let wm = self.wm("push", FILES_TABLE);

        let files = collect_files(&root);
        let current: std::collections::HashSet<String> =
            files.iter().map(|f| f.rel.clone()).collect();

        // Deletions: paths we pushed before that no longer exist locally.
        let manifest: Vec<String> = self
            .storage
            .get_kv("cloud:files:manifest")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let deleted: Vec<String> = manifest
            .iter()
            .filter(|p| !current.contains(*p))
            .cloned()
            .collect();

        let mut rows = Vec::new();
        let mut newest = wm.clone();
        for f in &files {
            if !newer(&f.mtime, &wm) {
                continue;
            }
            if newer(&f.mtime, &newest) {
                newest = f.mtime.clone();
            }
            rows.push(json!({
                "path": f.rel,
                "content": f.content,
                "updated_at": to_iso(&f.mtime),
            }));
        }
        let mut pushed = self
            .push_rows(auth, FILES_TABLE, "user_id,path", &rows)
            .await?;
        for p in &deleted {
            pushed += self
                .patch_deleted(auth, FILES_TABLE, "path", p, &now_iso())
                .await?;
        }
        if newest != wm {
            let _ = self.set_wm("push", FILES_TABLE, &newest);
        }
        let manifest_json =
            serde_json::to_string(&current.iter().cloned().collect::<Vec<_>>()).unwrap_or_default();
        let _ = self.storage.set_kv("cloud:files:manifest", &manifest_json);

        let pulled = self
            .pull_rows(auth, "pull", FILES_TABLE, |row| {
                let rel = row["path"].as_str().unwrap_or_default().to_string();
                if !is_allowed_rel(&rel) {
                    return Ok(false);
                }
                if let Some(del) = row["deleted_at"].as_str() {
                    if !del.is_empty() {
                        let _ = std::fs::remove_file(root.join(&rel));
                        return Ok(true);
                    }
                }
                let updated = row["updated_at"].as_str().unwrap_or_default();
                let abs = root.join(&rel);
                let local_mtime = std::fs::metadata(&abs)
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                    .unwrap_or_default();
                if newer(updated, &local_mtime) {
                    if let Some(content) = row["content"].as_str() {
                        if let Some(parent) = abs.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let _ = std::fs::write(&abs, content);
                        return Ok(true);
                    }
                }
                Ok(false)
            })
            .await?;

        Ok((pushed, pulled))
    }

    async fn patch_deleted(
        &self,
        auth: &CloudAuth,
        table: &str,
        col: &str,
        key: &str,
        ts: &str,
    ) -> Result<u64> {
        let url = format!(
            "{}/rest/v1/{}?{}=eq.{}",
            base_url(auth),
            table,
            col,
            urlencoding(key)
        );
        let res = self
            .http
            .patch(url)
            .header("apikey", &auth.anon_key)
            .header("Authorization", format!("Bearer {}", auth.access_token))
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .json(&json!({ "deleted_at": ts }))
            .send()
            .await?;
        if res.status().as_u16() == 401 {
            return Err(anyhow!("401 auth_required"));
        }
        Ok(1)
    }
}

/// Background sync loop: every 60s, if signed in, run a sync.
pub async fn run_cloud_sync_loop(cloud: CloudSync) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(SYNC_INTERVAL_SECS)).await;
        if !cloud.is_signed_in().await {
            continue;
        }
        match cloud.sync_now().await {
            Ok(st) => {
                if let Some(err) = st.last_error {
                    warn!("[CloudSync] sync completed with error: {}", err);
                } else {
                    info!(
                        "[CloudSync] synced (pushed {}, pulled {})",
                        st.pushed, st.pulled
                    );
                }
            }
            Err(e) => warn!("[CloudSync] sync failed: {}", e),
        }
    }
}

// ── helpers ─────────────────────────────────────────────────────

fn base_url(auth: &CloudAuth) -> String {
    auth.url.trim_end_matches('/').to_string()
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Normalize a local RFC3339 timestamp to a PostgREST-friendly UTC RFC3339.
fn to_iso(s: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(s) {
        Ok(dt) => dt.with_timezone(&chrono::Utc).to_rfc3339(),
        Err(_) => s.to_string(),
    }
}

/// true when `a` is strictly newer than `b` (empty `b` counts as older).
fn newer(a: &str, b: &str) -> bool {
    if a.is_empty() {
        return false;
    }
    if b.is_empty() {
        return true;
    }
    match (
        chrono::DateTime::parse_from_rfc3339(a),
        chrono::DateTime::parse_from_rfc3339(b),
    ) {
        (Ok(x), Ok(y)) => x > y,
        _ => a > b,
    }
}

fn urlencoding(s: &str) -> String {
    // Minimal percent-encoding for query values (timestamps / ids).
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b':' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn run_ts(r: &TaskRunRecord) -> String {
    r.finished_at
        .clone()
        .or_else(|| r.started_at.clone())
        .unwrap_or_else(|| r.created_at.clone())
}

fn task_to_json(t: &TaskRecord) -> Value {
    json!({
        "id": t.id,
        "title": t.title,
        "prompt": t.prompt,
        "cwd": t.cwd,
        "schedule": t.schedule,
        "status": t.status,
        "next_run_at": t.next_run_at,
        "model": t.model,
        "steps": t.steps,
        "created_at": t.created_at,
        "updated_at": to_iso(&t.updated_at),
    })
}

fn task_from_json(row: &Value) -> TaskRecord {
    let s = |k: &str| row[k].as_str().map(|x| x.to_string());
    TaskRecord {
        id: s("id").unwrap_or_default(),
        title: s("title").unwrap_or_default(),
        prompt: s("prompt").unwrap_or_default(),
        cwd: s("cwd"),
        schedule: s("schedule").unwrap_or_else(|| "{}".into()),
        status: s("status").unwrap_or_else(|| "active".into()),
        next_run_at: s("next_run_at"),
        created_at: s("created_at").unwrap_or_else(now_iso),
        updated_at: s("updated_at").unwrap_or_else(now_iso),
        model: s("model"),
        steps: s("steps"),
    }
}

fn run_to_json(r: &TaskRunRecord, ts: &str) -> Value {
    json!({
        "id": r.id,
        "task_id": r.task_id,
        "status": r.status,
        "trigger": r.trigger,
        "created_at": r.created_at,
        "started_at": r.started_at,
        "finished_at": r.finished_at,
        "exit_code": r.exit_code,
        "result": r.result,
        "error": r.error,
        "attempt": r.attempt,
        "updated_at": to_iso(ts),
    })
}

fn run_from_json(row: &Value) -> TaskRunRecord {
    let s = |k: &str| row[k].as_str().map(|x| x.to_string());
    TaskRunRecord {
        id: s("id").unwrap_or_default(),
        task_id: s("task_id").unwrap_or_default(),
        status: s("status").unwrap_or_else(|| "unknown".into()),
        trigger: s("trigger").unwrap_or_else(|| "cloud".into()),
        created_at: s("created_at").unwrap_or_else(now_iso),
        started_at: s("started_at"),
        finished_at: s("finished_at"),
        exit_code: row["exit_code"].as_i64().map(|n| n as i32),
        result: s("result"),
        error: s("error"),
        attempt: row["attempt"].as_i64().map(|n| n as i32),
    }
}

// ── file collection (phase 2: memories / skills / preferences) ──

struct SyncFile {
    rel: String,
    content: String,
    mtime: String,
}

const FILE_MAX_BYTES: u64 = 256 * 1024;

fn openpi_root() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("OPENPI_DIR") {
        return std::path::PathBuf::from(p);
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join(".openpi")
}

/// Allowlist of paths (relative to ~/.openpi) that may ever be synced.
/// Explicitly excludes secrets (models.json, auth.json), sessions, runs, logs.
fn is_allowed_rel(rel: &str) -> bool {
    if rel.contains("..") || rel.starts_with('/') {
        return false;
    }
    if rel.starts_with("memories/") {
        return true;
    }
    matches!(
        rel,
        "agent/settings.json" | "agent/app_settings.json" | "agent/HANDBOOK.md" | "agent/MEMORY.md"
    )
}

fn collect_files(root: &std::path::Path) -> Vec<SyncFile> {
    let mut out = Vec::new();
    for sub in ["memories", "agent"] {
        let dir = root.join(sub);
        if dir.is_dir() {
            walk_dir(root, &dir, &mut out);
        }
    }
    out
}

fn walk_dir(root: &std::path::Path, dir: &std::path::Path, out: &mut Vec<SyncFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if meta.is_dir() {
            walk_dir(root, &path, out);
            continue;
        }
        let Ok(rel_path) = path.strip_prefix(root) else {
            continue;
        };
        let rel = rel_path.to_string_lossy().replace('\\', "/");
        if !is_allowed_rel(&rel) {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(ext, "md" | "json" | "txt") {
            continue;
        }
        if meta.len() == 0 || meta.len() > FILE_MAX_BYTES {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue;
        };
        let mtime = meta
            .modified()
            .ok()
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
            .unwrap_or_else(now_iso);
        out.push(SyncFile { rel, content, mtime });
    }
}
