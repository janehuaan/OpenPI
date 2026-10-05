use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::{Arc, Mutex};
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct Storage {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub cwd: Option<String>,
    pub schedule: String,
    pub status: String,
    pub next_run_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub model: Option<String>,
    pub steps: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunRecord {
    pub id: String,
    pub task_id: String,
    pub status: String,
    pub trigger: String,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub exit_code: Option<i32>,
    pub result: Option<String>,
    pub error: Option<String>,
    pub attempt: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStepRunRecord {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryRecord {
    pub id: String,
    pub cwd: String,
    pub scope: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub key: String,
    pub value: String,
    pub body: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KvRecord {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CasStats {
    pub blob_count: usize,
    pub total_ref_count: usize,
    pub unique_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryTurnRecord {
    pub turn_index: u64,
    pub role: String,
    pub content: String,
    pub created_at: String,
}

impl Storage {
    pub fn in_memory() -> anyhow::Result<Self> {
        let conn = Connection::open_in_memory()?;
        let storage = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        storage.init_schema()?;
        Ok(storage)
    }

    pub fn open<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;",
        )?;
        let storage = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        storage.init_schema()?;
        Ok(storage)
    }

    fn init_schema(&self) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                cwd TEXT NOT NULL,
                mode TEXT NOT NULL,
                name TEXT,
                model TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                prompt TEXT NOT NULL,
                cwd TEXT,
                schedule TEXT NOT NULL,
                status TEXT NOT NULL,
                next_run_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                model TEXT,
                steps TEXT
            );

            CREATE TABLE IF NOT EXISTS task_runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                status TEXT NOT NULL,
                trigger TEXT NOT NULL,
                created_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                exit_code INTEGER,
                result TEXT,
                error TEXT,
                attempt INTEGER DEFAULT 1,
                FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS task_step_runs (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                step_id TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                exit_code INTEGER,
                error TEXT,
                FOREIGN KEY (run_id) REFERENCES task_runs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS memory_entries (
                id TEXT PRIMARY KEY,
                cwd TEXT NOT NULL,
                scope TEXT NOT NULL,
                entry_type TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                body TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE (cwd, scope, entry_type, key)
            );

            CREATE TABLE IF NOT EXISTS key_values (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cas_blobs (
                hash TEXT PRIMARY KEY,
                content BLOB NOT NULL,
                size_bytes INTEGER NOT NULL,
                ref_count INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS session_history (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                turn_index INTEGER NOT NULL,
                role TEXT NOT NULL,
                content_hash TEXT NOT NULL REFERENCES cas_blobs(hash),
                created_at TEXT NOT NULL
            );",
        )?;
        Ok(())
    }

    // --- Tasks operations ---
    pub fn insert_task(&self, task: &TaskRecord) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, prompt, cwd, schedule, status, next_run_at, created_at, updated_at, model, steps)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                task.id,
                task.title,
                task.prompt,
                task.cwd,
                task.schedule,
                task.status,
                task.next_run_at,
                task.created_at,
                task.updated_at,
                task.model,
                task.steps,
            ],
        )?;
        Ok(())
    }

    pub fn list_tasks(&self) -> anyhow::Result<Vec<TaskRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, prompt, cwd, schedule, status, next_run_at, created_at, updated_at, model, steps FROM tasks ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TaskRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                prompt: row.get(2)?,
                cwd: row.get(3)?,
                schedule: row.get(4)?,
                status: row.get(5)?,
                next_run_at: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                model: row.get(9)?,
                steps: row.get(10)?,
            })
        })?;

        let mut tasks = Vec::new();
        for r in rows {
            tasks.push(r?);
        }
        Ok(tasks)
    }

    pub fn get_task(&self, id: &str) -> anyhow::Result<Option<TaskRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, prompt, cwd, schedule, status, next_run_at, created_at, updated_at, model, steps FROM tasks WHERE id = ?1",
        )?;
        let task = stmt.query_row(params![id], |row| {
            Ok(TaskRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                prompt: row.get(2)?,
                cwd: row.get(3)?,
                schedule: row.get(4)?,
                status: row.get(5)?,
                next_run_at: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                model: row.get(9)?,
                steps: row.get(10)?,
            })
        }).optional()?;
        Ok(task)
    }

    pub fn delete_task(&self, id: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let count = conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
        Ok(count > 0)
    }

    pub fn set_task_paused(&self, id: &str, paused: bool) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let status = if paused { "paused" } else { "active" };
        let count = conn.execute("UPDATE tasks SET status = ?1 WHERE id = ?2", params![status, id])?;
        Ok(count > 0)
    }

    // --- Task Runs ---
    pub fn insert_run(&self, run: &TaskRunRecord) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO task_runs (id, task_id, status, trigger, created_at, started_at, finished_at, exit_code, result, error, attempt)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                run.id,
                run.task_id,
                run.status,
                run.trigger,
                run.created_at,
                run.started_at,
                run.finished_at,
                run.exit_code,
                run.result,
                run.error,
                run.attempt,
            ],
        )?;
        Ok(())
    }

    pub fn list_runs_for_task(&self, task_id: &str) -> anyhow::Result<Vec<TaskRunRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, status, trigger, created_at, started_at, finished_at, exit_code, result, error, attempt
             FROM task_runs WHERE task_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![task_id], |row| {
            Ok(TaskRunRecord {
                id: row.get(0)?,
                task_id: row.get(1)?,
                status: row.get(2)?,
                trigger: row.get(3)?,
                created_at: row.get(4)?,
                started_at: row.get(5)?,
                finished_at: row.get(6)?,
                exit_code: row.get(7)?,
                result: row.get(8)?,
                error: row.get(9)?,
                attempt: row.get(10)?,
            })
        })?;

        let mut runs = Vec::new();
        for r in rows {
            runs.push(r?);
        }
        Ok(runs)
    }

    pub fn cancel_run(&self, run_id: &str) -> anyhow::Result<Option<TaskRunRecord>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE task_runs SET status = 'cancelled', finished_at = ?1, error = 'Cancelled by user' WHERE id = ?2",
            rusqlite::params![now, run_id],
        )?;
        let mut stmt = conn.prepare(
            "SELECT id, task_id, status, trigger, created_at, started_at, finished_at, exit_code, result, error, attempt
             FROM task_runs WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![run_id], |row| {
            Ok(TaskRunRecord {
                id: row.get(0)?,
                task_id: row.get(1)?,
                status: row.get(2)?,
                trigger: row.get(3)?,
                created_at: row.get(4)?,
                started_at: row.get(5)?,
                finished_at: row.get(6)?,
                exit_code: row.get(7)?,
                result: row.get(8)?,
                error: row.get(9)?,
                attempt: row.get(10)?,
            })
        })?;
        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn get_run(&self, run_id: &str) -> anyhow::Result<Option<TaskRunRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, status, trigger, created_at, started_at, finished_at, exit_code, result, error, attempt
             FROM task_runs WHERE id = ?1",
        )?;
        let mut rows = stmt.query_map(rusqlite::params![run_id], |row| {
            Ok(TaskRunRecord {
                id: row.get(0)?,
                task_id: row.get(1)?,
                status: row.get(2)?,
                trigger: row.get(3)?,
                created_at: row.get(4)?,
                started_at: row.get(5)?,
                finished_at: row.get(6)?,
                exit_code: row.get(7)?,
                result: row.get(8)?,
                error: row.get(9)?,
                attempt: row.get(10)?,
            })
        })?;
        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    pub fn get_due_tasks(&self, now: &str) -> anyhow::Result<Vec<TaskRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, prompt, cwd, schedule, status, next_run_at, created_at, updated_at, model, steps
             FROM tasks
             WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?1
             ORDER BY next_run_at ASC",
        )?;
        let rows = stmt.query_map(params![now], |row| {
            Ok(TaskRecord {
                id: row.get(0)?,
                title: row.get(1)?,
                prompt: row.get(2)?,
                cwd: row.get(3)?,
                schedule: row.get(4)?,
                status: row.get(5)?,
                next_run_at: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                model: row.get(9)?,
                steps: row.get(10)?,
            })
        })?;

        let mut tasks = Vec::new();
        for r in rows {
            tasks.push(r?);
        }
        Ok(tasks)
    }

    pub fn update_task_next_run(
        &self,
        task_id: &str,
        next_run: Option<&str>,
        status: Option<&str>,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        if let Some(st) = status {
            conn.execute(
                "UPDATE tasks SET next_run_at = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
                params![next_run, st, now, task_id],
            )?;
        } else {
            conn.execute(
                "UPDATE tasks SET next_run_at = ?1, updated_at = ?2 WHERE id = ?3",
                params![next_run, now, task_id],
            )?;
        }
        Ok(())
    }

    pub fn update_run_finish(
        &self,
        run_id: &str,
        status: &str,
        exit_code: i32,
        result: Option<&str>,
        error: Option<&str>,
        finished_at: &str,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE task_runs
             SET status = ?1, exit_code = ?2, result = ?3, error = ?4, finished_at = ?5
             WHERE id = ?6",
            params![status, exit_code, result, error, finished_at, run_id],
        )?;
        Ok(())
    }

    // --- Task Step Runs ---
    pub fn insert_step_run(&self, step_run: &TaskStepRunRecord) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO task_step_runs (id, run_id, step_id, status, started_at, finished_at, exit_code, error)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                step_run.id,
                step_run.run_id,
                step_run.step_id,
                step_run.status,
                step_run.started_at,
                step_run.finished_at,
                step_run.exit_code,
                step_run.error,
            ],
        )?;
        Ok(())
    }

    pub fn update_step_run_finish(
        &self,
        id: &str,
        status: &str,
        exit_code: i32,
        error: Option<&str>,
        finished_at: &str,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE task_step_runs
             SET status = ?1, exit_code = ?2, error = ?3, finished_at = ?4
             WHERE id = ?5",
            params![status, exit_code, error, finished_at, id],
        )?;
        Ok(())
    }

    pub fn list_step_runs_for_run(&self, run_id: &str) -> anyhow::Result<Vec<TaskStepRunRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, run_id, step_id, status, started_at, finished_at, exit_code, error
             FROM task_step_runs WHERE run_id = ?1 ORDER BY started_at ASC",
        )?;
        let rows = stmt.query_map(params![run_id], |row| {
            Ok(TaskStepRunRecord {
                id: row.get(0)?,
                run_id: row.get(1)?,
                step_id: row.get(2)?,
                status: row.get(3)?,
                started_at: row.get(4)?,
                finished_at: row.get(5)?,
                exit_code: row.get(6)?,
                error: row.get(7)?,
            })
        })?;

        let mut steps = Vec::new();
        for r in rows {
            steps.push(r?);
        }
        Ok(steps)
    }

    // --- Memory Operations ---
    pub fn upsert_memory(&self, rec: &MemoryRecord) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO memory_entries (id, cwd, scope, entry_type, key, value, body, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(cwd, scope, entry_type, key) DO UPDATE SET
             value = excluded.value,
             body = excluded.body,
             updated_at = excluded.updated_at",
            params![
                rec.id,
                rec.cwd,
                rec.scope,
                rec.entry_type,
                rec.key,
                rec.value,
                rec.body,
                rec.created_at,
                rec.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_memory(&self, cwd: &str, scope: Option<&str>) -> anyhow::Result<Vec<MemoryRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut results = Vec::new();

        if let Some(s) = scope {
            let mut stmt = conn.prepare(
                "SELECT id, cwd, scope, entry_type, key, value, body, created_at, updated_at
                 FROM memory_entries WHERE cwd = ?1 AND scope = ?2 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![cwd, s], |row| {
                Ok(MemoryRecord {
                    id: row.get(0)?,
                    cwd: row.get(1)?,
                    scope: row.get(2)?,
                    entry_type: row.get(3)?,
                    key: row.get(4)?,
                    value: row.get(5)?,
                    body: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?;
            for r in rows { results.push(r?); }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, cwd, scope, entry_type, key, value, body, created_at, updated_at
                 FROM memory_entries WHERE cwd = ?1 ORDER BY updated_at DESC",
            )?;
            let rows = stmt.query_map(params![cwd], |row| {
                Ok(MemoryRecord {
                    id: row.get(0)?,
                    cwd: row.get(1)?,
                    scope: row.get(2)?,
                    entry_type: row.get(3)?,
                    key: row.get(4)?,
                    value: row.get(5)?,
                    body: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })?;
            for r in rows { results.push(r?); }
        }

        Ok(results)
    }

    pub fn delete_memory(&self, cwd: &str, scope: Option<&str>, entry_type: &str, key: &str) -> anyhow::Result<bool> {
        let conn = self.conn.lock().unwrap();
        let count = if let Some(s) = scope {
            conn.execute(
                "DELETE FROM memory_entries WHERE cwd = ?1 AND scope = ?2 AND entry_type = ?3 AND key = ?4",
                params![cwd, s, entry_type, key],
            )?
        } else {
            conn.execute(
                "DELETE FROM memory_entries WHERE cwd = ?1 AND entry_type = ?3 AND key = ?4",
                params![cwd, entry_type, key],
            )?
        };
        Ok(count > 0)
    }

    // --- Key-Value store (profiles, settings) ---
    pub fn get_kv(&self, key: &str) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM key_values WHERE key = ?1")?;
        let res = stmt.query_row(params![key], |row| row.get(0)).optional()?;
        Ok(res)
    }

    pub fn set_kv(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO key_values (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, now],
        )?;
        Ok(())
    }

    // --- Cloud sync helpers (used by openpi-daemon::cloud_sync) ---

    /// Upsert a key/value row preserving the caller-supplied `updated_at`
    /// (used when applying rows pulled from the cloud, so LWW stays correct).
    pub fn upsert_kv_raw(&self, key: &str, value: &str, updated_at: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO key_values (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, updated_at],
        )?;
        Ok(())
    }

    pub fn list_kv(&self) -> anyhow::Result<Vec<KvRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT key, value, updated_at FROM key_values")?;
        let rows = stmt.query_map([], |row| {
            Ok(KvRecord {
                key: row.get(0)?,
                value: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    // ---------------------------------------------------------
    // CAS (Content-Addressable Storage) & Session History
    // ---------------------------------------------------------

    /// Stores a payload in CAS by SHA-256 hash. If it already exists, increments ref_count.
    /// Returns (hash, is_newly_inserted).
    pub fn put_cas_blob(&self, content: &[u8]) -> anyhow::Result<(String, bool)> {
        use sha2::{Digest, Sha256};
        let hash = format!("{:x}", Sha256::digest(content));
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();

        let updated = conn.execute(
            "UPDATE cas_blobs SET ref_count = ref_count + 1 WHERE hash = ?1",
            params![hash],
        )?;

        if updated > 0 {
            Ok((hash, false))
        } else {
            conn.execute(
                "INSERT INTO cas_blobs (hash, content, size_bytes, ref_count, created_at)
                 VALUES (?1, ?2, ?3, 1, ?4)",
                params![hash, content, content.len() as i64, now],
            )?;
            Ok((hash, true))
        }
    }

    /// Retrieves CAS blob content by SHA-256 hash.
    pub fn get_cas_blob(&self, hash: &str) -> anyhow::Result<Option<Vec<u8>>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT content FROM cas_blobs WHERE hash = ?1")?;
        let res = stmt.query_row(params![hash], |row| row.get(0)).optional()?;
        Ok(res)
    }

    /// Appends a turn to session history, storing its text payload into CAS for zero-redundancy.
    pub fn append_history_turn(
        &self,
        session_id: &str,
        turn_index: u64,
        role: &str,
        content: &str,
    ) -> anyhow::Result<String> {
        let (hash, _) = self.put_cas_blob(content.as_bytes())?;
        let id = format!("{}:{}", session_id, turn_index);
        let now = chrono::Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO session_history (id, session_id, turn_index, role, content_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET content_hash = excluded.content_hash",
            params![id, session_id, turn_index as i64, role, hash, now],
        )?;
        Ok(hash)
    }

    /// Fetches all history turns for a session in order, resolving content from CAS.
    pub fn get_session_history(&self, session_id: &str) -> anyhow::Result<Vec<HistoryTurnRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT h.turn_index, h.role, b.content, h.created_at
             FROM session_history h
             JOIN cas_blobs b ON h.content_hash = b.hash
             WHERE h.session_id = ?1
             ORDER BY h.turn_index ASC",
        )?;
        let rows = stmt.query_map(params![session_id], |row| {
            let blob: Vec<u8> = row.get(2)?;
            let text = String::from_utf8_lossy(&blob).to_string();
            Ok(HistoryTurnRecord {
                turn_index: row.get::<_, i64>(0)? as u64,
                role: row.get(1)?,
                content: text,
                created_at: row.get(3)?,
            })
        })?;
        let mut res = Vec::new();
        for r in rows {
            res.push(r?);
        }
        Ok(res)
    }

    /// Returns storage-level CAS statistics (blob count, total ref count, total unique bytes).
    pub fn get_cas_stats(&self) -> anyhow::Result<CasStats> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT COUNT(*), COALESCE(SUM(ref_count), 0), COALESCE(SUM(size_bytes), 0)
             FROM cas_blobs",
        )?;
        stmt.query_row([], |row| {
            Ok(CasStats {
                blob_count: row.get::<_, i64>(0)? as usize,
                total_ref_count: row.get::<_, i64>(1)? as usize,
                unique_bytes: row.get::<_, i64>(2)? as usize,
            })
        })
        .map_err(Into::into)
    }

    /// Upsert a task by id preserving the given `updated_at`/`created_at`.
    pub fn upsert_task_raw(&self, task: &TaskRecord) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, prompt, cwd, schedule, status, next_run_at, created_at, updated_at, model, steps)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
                 title = excluded.title,
                 prompt = excluded.prompt,
                 cwd = excluded.cwd,
                 schedule = excluded.schedule,
                 status = excluded.status,
                 next_run_at = excluded.next_run_at,
                 updated_at = excluded.updated_at,
                 model = excluded.model,
                 steps = excluded.steps",
            params![
                task.id,
                task.title,
                task.prompt,
                task.cwd,
                task.schedule,
                task.status,
                task.next_run_at,
                task.created_at,
                task.updated_at,
                task.model,
                task.steps,
            ],
        )?;
        Ok(())
    }

    pub fn list_all_runs(&self) -> anyhow::Result<Vec<TaskRunRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, task_id, status, trigger, created_at, started_at, finished_at, exit_code, result, error, attempt
             FROM task_runs ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TaskRunRecord {
                id: row.get(0)?,
                task_id: row.get(1)?,
                status: row.get(2)?,
                trigger: row.get(3)?,
                created_at: row.get(4)?,
                started_at: row.get(5)?,
                finished_at: row.get(6)?,
                exit_code: row.get(7)?,
                result: row.get(8)?,
                error: row.get(9)?,
                attempt: row.get(10)?,
            })
        })?;
        let mut runs = Vec::new();
        for r in rows {
            runs.push(r?);
        }
        Ok(runs)
    }

    /// Upsert a task run by id preserving the given timestamps.
    pub fn upsert_run_raw(&self, run: &TaskRunRecord) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO task_runs (id, task_id, status, trigger, created_at, started_at, finished_at, exit_code, result, error, attempt)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(id) DO UPDATE SET
                 status = excluded.status,
                 started_at = excluded.started_at,
                 finished_at = excluded.finished_at,
                 exit_code = excluded.exit_code,
                 result = excluded.result,
                 error = excluded.error,
                 attempt = excluded.attempt",
            params![
                run.id,
                run.task_id,
                run.status,
                run.trigger,
                run.created_at,
                run.started_at,
                run.finished_at,
                run.exit_code,
                run.result,
                run.error,
                run.attempt,
            ],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_storage_crud() {
        let storage = Storage::in_memory().unwrap();
        let now = chrono::Utc::now().to_rfc3339();

        let task = TaskRecord {
            id: "t1".into(),
            title: "Task 1".into(),
            prompt: "Test prompt".into(),
            cwd: Some("/tmp".into()),
            schedule: r#"{"kind":"once","runAt":"2026-09-14T20:00:00Z"}"#.into(),
            status: "active".into(),
            next_run_at: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            model: None,
            steps: None,
        };

        storage.insert_task(&task).unwrap();
        let tasks = storage.list_tasks().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].id, "t1");

        storage.set_task_paused("t1", true).unwrap();
        let fetched = storage.get_task("t1").unwrap().unwrap();
        assert_eq!(fetched.status, "paused");

        // Test memory
        let mem = MemoryRecord {
            id: "m1".into(),
            cwd: "/tmp".into(),
            scope: "project".into(),
            entry_type: "fact".into(),
            key: "framework".into(),
            value: "React".into(),
            body: Some("Used for UI".into()),
            created_at: now.clone(),
            updated_at: now,
        };
        storage.upsert_memory(&mem).unwrap();
        let memories = storage.list_memory("/tmp", None).unwrap();
        assert_eq!(memories.len(), 1);
        assert_eq!(memories[0].value, "React");

        storage.delete_task("t1").unwrap();
        assert!(storage.get_task("t1").unwrap().is_none());
    }

    #[test]
    fn test_storage_due_tasks_and_runs() {
        let storage = Storage::in_memory().unwrap();
        let now = chrono::Utc::now();
        let past = (now - chrono::Duration::minutes(5)).to_rfc3339();
        let future = (now + chrono::Duration::minutes(5)).to_rfc3339();

        let task1 = TaskRecord {
            id: "t-due".into(),
            title: "Due Task".into(),
            prompt: "Run due".into(),
            cwd: None,
            schedule: r#"{"kind":"once"}"#.into(),
            status: "active".into(),
            next_run_at: Some(past.clone()),
            created_at: past.clone(),
            updated_at: past.clone(),
            model: None,
            steps: None,
        };
        let task2 = TaskRecord {
            id: "t-future".into(),
            title: "Future Task".into(),
            prompt: "Run future".into(),
            cwd: None,
            schedule: r#"{"kind":"once"}"#.into(),
            status: "active".into(),
            next_run_at: Some(future),
            created_at: past.clone(),
            updated_at: past.clone(),
            model: None,
            steps: None,
        };
        storage.insert_task(&task1).unwrap();
        storage.insert_task(&task2).unwrap();

        let due = storage.get_due_tasks(&now.to_rfc3339()).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, "t-due");

        // Test update next run
        storage.update_task_next_run("t-due", None, Some("completed")).unwrap();
        let updated = storage.get_task("t-due").unwrap().unwrap();
        assert_eq!(updated.status, "completed");
        assert!(updated.next_run_at.is_none());

        // Test run update finish
        let run = TaskRunRecord {
            id: "r1".into(),
            task_id: "t-due".into(),
            status: "running".into(),
            trigger: "cron".into(),
            created_at: past.clone(),
            started_at: Some(past.clone()),
            finished_at: None,
            exit_code: None,
            result: None,
            error: None,
            attempt: Some(1),
        };
        storage.insert_run(&run).unwrap();
        storage.update_run_finish("r1", "succeeded", 0, Some("done output"), None, &now.to_rfc3339()).unwrap();
        let fetched_run = storage.get_run("r1").unwrap().unwrap();
        assert_eq!(fetched_run.status, "succeeded");
        assert_eq!(fetched_run.exit_code, Some(0));
        assert_eq!(fetched_run.result.as_deref(), Some("done output"));

        // Test step run
        let step_run = TaskStepRunRecord {
            id: "sr1".into(),
            run_id: "r1".into(),
            step_id: "step-1".into(),
            status: "running".into(),
            started_at: Some(past),
            finished_at: None,
            exit_code: None,
            error: None,
        };
        storage.insert_step_run(&step_run).unwrap();
        storage.update_step_run_finish("sr1", "succeeded", 0, None, &now.to_rfc3339()).unwrap();
        let step_runs = storage.list_step_runs_for_run("r1").unwrap();
        assert_eq!(step_runs.len(), 1);
        assert_eq!(step_runs[0].status, "succeeded");
    }

    #[test]
    fn test_cas_deduplication() {
        let storage = Storage::in_memory().unwrap();
        let payload = "console.log('identical across 100 turns');";

        let (hash1, inserted1) = storage.put_cas_blob(payload.as_bytes()).unwrap();
        assert!(inserted1, "first insert should be new");

        let (hash2, inserted2) = storage.put_cas_blob(payload.as_bytes()).unwrap();
        assert_eq!(hash1, hash2);
        assert!(!inserted2, "duplicate payload should reuse hash without re-inserting");

        let stats = storage.get_cas_stats().unwrap();
        assert_eq!(stats.blob_count, 1);
        assert_eq!(stats.total_ref_count, 2);

        let recovered = storage.get_cas_blob(&hash1).unwrap().unwrap();
        assert_eq!(String::from_utf8(recovered).unwrap(), payload);

        // Append to history
        storage.append_history_turn("sess-1", 0, "user", "hi").unwrap();
        storage.append_history_turn("sess-1", 1, "tool", payload).unwrap();
        let history = storage.get_session_history("sess-1").unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[1].content, payload);
    }
}
