/**
 * OpenPI Memory Database (Codex Two-Stage Pipeline State Machine)
 *
 * Implements the exact SQLite state machine used in OpenAI Codex:
 * - stage1_outputs: extracted raw memories and session narrative summaries per thread
 * - jobs: distributed-safe lease-based job queue for stage 1 extraction and global consolidation
 *
 * Uses Node.js native `node:sqlite` (DatabaseSync) with zero external dependencies.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { memoriesDbPath } from "../config.ts";

export type JobKind = "memory_stage1" | "memory_consolidate_global";
export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface Stage1Output {
	thread_id: string; // sessionId
	source_updated_at: number;
	raw_memory: string;
	rollout_summary: string;
	rollout_slug: string | null;
	generated_at: number;
	usage_count: number;
	last_usage: number | null;
	selected_for_phase2: number; // 0 or 1
	selected_for_phase2_source_updated_at: number | null;
}

export interface MemoryJob {
	kind: JobKind;
	job_key: string; // e.g. sessionId or "global"
	status: JobStatus;
	worker_id: string | null;
	ownership_token: string | null;
	started_at: number | null;
	finished_at: number | null;
	lease_until: number | null;
	retry_at: number | null;
	retry_remaining: number;
	last_error: string | null;
	input_watermark: number | null;
	last_success_watermark: number | null;
}

export interface JobStats {
	pending: number;
	running: number;
	completed: number;
	failed: number;
	unconsolidatedStage1: number;
}

export class MemoryDb {
	private db: DatabaseSync;

	constructor(dbPath: string = memoriesDbPath()) {
		if (dbPath !== ":memory:") {
			mkdirSync(dirname(dbPath), { recursive: true });
		}
		this.db = new DatabaseSync(dbPath);
		this.initSchema();
	}

	private initSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS stage1_outputs (
				thread_id TEXT PRIMARY KEY,
				source_updated_at INTEGER NOT NULL,
				raw_memory TEXT NOT NULL,
				rollout_summary TEXT NOT NULL,
				rollout_slug TEXT,
				generated_at INTEGER NOT NULL,
				usage_count INTEGER DEFAULT 0,
				last_usage INTEGER,
				selected_for_phase2 INTEGER NOT NULL DEFAULT 0,
				selected_for_phase2_source_updated_at INTEGER
			);

			CREATE TABLE IF NOT EXISTS jobs (
				kind TEXT NOT NULL,
				job_key TEXT NOT NULL,
				status TEXT NOT NULL,
				worker_id TEXT,
				ownership_token TEXT,
				started_at INTEGER,
				finished_at INTEGER,
				lease_until INTEGER,
				retry_at INTEGER,
				retry_remaining INTEGER NOT NULL,
				last_error TEXT,
				input_watermark INTEGER,
				last_success_watermark INTEGER,
				PRIMARY KEY (kind, job_key)
			);

			CREATE INDEX IF NOT EXISTS idx_jobs_status_lease ON jobs (status, lease_until);
			CREATE INDEX IF NOT EXISTS idx_stage1_selected ON stage1_outputs (selected_for_phase2, source_updated_at);
		`);
	}

	public close(): void {
		this.db.close();
	}

	/**
	 * Enqueue or re-arm a job. If the job already exists, its status is updated to pending
	 * if it was completed or failed, or updated with the new watermark.
	 */
	public enqueueJob(
		kind: JobKind,
		jobKey: string,
		options: {
			inputWatermark?: number;
			retryRemaining?: number;
		} = {},
	): void {
		const now = Date.now();
		const retryRemaining = options.retryRemaining ?? 3;
		const inputWatermark = options.inputWatermark ?? now;

		const existing = this.getJob(kind, jobKey);
		if (!existing) {
			const stmt = this.db.prepare(`
				INSERT INTO jobs (
					kind, job_key, status, worker_id, ownership_token,
					started_at, finished_at, lease_until, retry_at,
					retry_remaining, last_error, input_watermark, last_success_watermark
				) VALUES (
					?, ?, 'pending', NULL, NULL,
					NULL, NULL, NULL, 0,
					?, NULL, ?, NULL
				)
			`);
			stmt.run(kind, jobKey, retryRemaining, inputWatermark);
			return;
		}

		// If running with active lease, update watermark only
		if (existing.status === "running" && existing.lease_until && existing.lease_until > now) {
			const stmt = this.db.prepare(`
				UPDATE jobs
				SET input_watermark = MAX(COALESCE(input_watermark, 0), ?)
				WHERE kind = ? AND job_key = ?
			`);
			stmt.run(inputWatermark, kind, jobKey);
			return;
		}

		// Re-arm job as pending
		const stmt = this.db.prepare(`
			UPDATE jobs
			SET status = 'pending',
				ownership_token = NULL,
				worker_id = NULL,
				started_at = NULL,
				finished_at = NULL,
				lease_until = NULL,
				retry_at = 0,
				retry_remaining = ?,
				input_watermark = MAX(COALESCE(input_watermark, 0), ?),
				last_error = NULL
			WHERE kind = ? AND job_key = ?
		`);
		stmt.run(retryRemaining, inputWatermark, kind, jobKey);
	}

	public getJob(kind: JobKind, jobKey: string): MemoryJob | undefined {
		const stmt = this.db.prepare(`
			SELECT * FROM jobs WHERE kind = ? AND job_key = ?
		`);
		return stmt.get(kind, jobKey) as MemoryJob | undefined;
	}

	public listJobs(limit = 100): MemoryJob[] {
		const stmt = this.db.prepare(`
			SELECT * FROM jobs ORDER BY COALESCE(started_at, finished_at, 0) DESC LIMIT ?
		`);
		return stmt.all(limit) as unknown as MemoryJob[];
	}

	/**
	 * Atomically claims the next runnable job.
	 * Matches pending jobs, running jobs whose lease expired, or failed jobs ready for retry.
	 */
	public claimNextJob(
		workerId: string,
		kinds?: JobKind[],
		leaseDurationMs = 30_000,
	): { job: MemoryJob; ownershipToken: string } | null {
		const now = Date.now();
		const leaseUntil = now + leaseDurationMs;
		const ownershipToken = randomUUID();

		const kindFilter =
			kinds && kinds.length > 0 ? `AND kind IN (${kinds.map(() => "?").join(",")})` : "";
		const kindArgs = kinds && kinds.length > 0 ? kinds : [];

		// Query for candidate job
		const candidateStmt = this.db.prepare(`
			SELECT * FROM jobs
			WHERE (
				status = 'pending'
				OR (status = 'running' AND lease_until < ?)
				OR (status = 'failed' AND retry_remaining > 0 AND retry_at <= ?)
			)
			${kindFilter}
			ORDER BY
				CASE kind
					WHEN 'memory_stage1' THEN 1
					WHEN 'memory_consolidate_global' THEN 2
					ELSE 3
				END ASC,
				COALESCE(started_at, 0) ASC
			LIMIT 1
		`);

		const candidate = candidateStmt.get(now, now, ...kindArgs) as MemoryJob | undefined;
		if (!candidate) return null;

		// Atomically acquire lease
		const updateStmt = this.db.prepare(`
			UPDATE jobs
			SET status = 'running',
				worker_id = ?,
				ownership_token = ?,
				started_at = ?,
				lease_until = ?
			WHERE kind = ?
			  AND job_key = ?
			  AND (
				status = 'pending'
				OR (status = 'running' AND lease_until < ?)
				OR (status = 'failed' AND retry_remaining > 0 AND retry_at <= ?)
			  )
		`);

		const result = updateStmt.run(
			workerId,
			ownershipToken,
			now,
			leaseUntil,
			candidate.kind,
			candidate.job_key,
			now,
			now,
		);

		if (Number(result.changes) === 0) {
			// Lost race with another worker
			return null;
		}

		candidate.status = "running";
		candidate.worker_id = workerId;
		candidate.ownership_token = ownershipToken;
		candidate.started_at = now;
		candidate.lease_until = leaseUntil;

		return { job: candidate, ownershipToken };
	}

	/**
	 * Extends lease time for an ongoing job.
	 */
	public renewLease(
		kind: JobKind,
		jobKey: string,
		ownershipToken: string,
		extendMs = 30_000,
	): boolean {
		const now = Date.now();
		const stmt = this.db.prepare(`
			UPDATE jobs
			SET lease_until = ?
			WHERE kind = ? AND job_key = ? AND ownership_token = ? AND status = 'running'
		`);
		const result = stmt.run(now + extendMs, kind, jobKey, ownershipToken);
		return Number(result.changes) > 0;
	}

	/**
	 * Marks a job as completed with success watermark.
	 */
	public completeJob(
		kind: JobKind,
		jobKey: string,
		ownershipToken: string,
		successWatermark?: number,
	): boolean {
		const now = Date.now();
		const stmt = this.db.prepare(`
			UPDATE jobs
			SET status = 'completed',
				finished_at = ?,
				ownership_token = NULL,
				lease_until = NULL,
				last_error = NULL,
				last_success_watermark = COALESCE(?, input_watermark, ?)
			WHERE kind = ? AND job_key = ? AND ownership_token = ?
		`);
		const result = stmt.run(now, successWatermark ?? now, now, kind, jobKey, ownershipToken);
		return Number(result.changes) > 0;
	}

	/**
	 * Marks a job as failed, calculating retry schedule if attempts remain.
	 */
	public failJob(
		kind: JobKind,
		jobKey: string,
		ownershipToken: string,
		error: string,
		retryDelayMs = 15_000,
	): boolean {
		const now = Date.now();
		const current = this.getJob(kind, jobKey);
		const remaining = current ? Math.max(0, current.retry_remaining - 1) : 0;
		const retryAt = remaining > 0 ? now + retryDelayMs : 0;
		const status: JobStatus = remaining > 0 ? "failed" : "failed";

		const stmt = this.db.prepare(`
			UPDATE jobs
			SET status = ?,
				finished_at = ?,
				ownership_token = NULL,
				lease_until = NULL,
				retry_remaining = ?,
				retry_at = ?,
				last_error = ?
			WHERE kind = ? AND job_key = ? AND ownership_token = ?
		`);
		const result = stmt.run(status, now, remaining, retryAt, error, kind, jobKey, ownershipToken);
		return Number(result.changes) > 0;
	}

	// -------------------------------------------------------------------------
	// Stage 1 Outputs API
	// -------------------------------------------------------------------------

	public saveStage1Output(
		output: Omit<
			Stage1Output,
			"usage_count" | "last_usage" | "selected_for_phase2" | "selected_for_phase2_source_updated_at"
		> &
			Partial<Stage1Output>,
	): void {
		const now = Date.now();
		const stmt = this.db.prepare(`
			INSERT INTO stage1_outputs (
				thread_id, source_updated_at, raw_memory, rollout_summary, rollout_slug,
				generated_at, usage_count, last_usage, selected_for_phase2, selected_for_phase2_source_updated_at
			) VALUES (
				?, ?, ?, ?, ?,
				?, ?, ?, ?, ?
			)
			ON CONFLICT(thread_id) DO UPDATE SET
				source_updated_at = excluded.source_updated_at,
				raw_memory = excluded.raw_memory,
				rollout_summary = excluded.rollout_summary,
				rollout_slug = excluded.rollout_slug,
				generated_at = excluded.generated_at,
				selected_for_phase2 = 0,
				selected_for_phase2_source_updated_at = NULL
		`);

		stmt.run(
			output.thread_id,
			output.source_updated_at,
			output.raw_memory,
			output.rollout_summary,
			output.rollout_slug ?? null,
			output.generated_at ?? now,
			output.usage_count ?? 0,
			output.last_usage ?? null,
			output.selected_for_phase2 ?? 0,
			output.selected_for_phase2_source_updated_at ?? null,
		);
	}

	public getStage1Output(threadId: string): Stage1Output | undefined {
		const stmt = this.db.prepare(`
			SELECT * FROM stage1_outputs WHERE thread_id = ?
		`);
		return stmt.get(threadId) as Stage1Output | undefined;
	}

	public getUnconsolidatedStage1Outputs(limit = 100): Stage1Output[] {
		const stmt = this.db.prepare(`
			SELECT * FROM stage1_outputs
			WHERE selected_for_phase2 = 0
			ORDER BY source_updated_at ASC
			LIMIT ?
		`);
		return stmt.all(limit) as unknown as Stage1Output[];
	}

	public markStage1OutputsSelected(threadIds: string[]): void {
		if (threadIds.length === 0) return;
		const now = Date.now();
		const placeholders = threadIds.map(() => "?").join(",");
		const stmt = this.db.prepare(`
			UPDATE stage1_outputs
			SET selected_for_phase2 = 1,
				selected_for_phase2_source_updated_at = ?
			WHERE thread_id IN (${placeholders})
		`);
		stmt.run(now, ...threadIds);
	}

	public listStage1Outputs(limit = 50, offset = 0): Stage1Output[] {
		const stmt = this.db.prepare(`
			SELECT * FROM stage1_outputs
			ORDER BY source_updated_at DESC
			LIMIT ? OFFSET ?
		`);
		return stmt.all(limit, offset) as unknown as Stage1Output[];
	}

	public getJobStats(): JobStats {
		const pendingStmt = this.db.prepare(`SELECT count(*) as c FROM jobs WHERE status = 'pending'`);
		const runningStmt = this.db.prepare(`SELECT count(*) as c FROM jobs WHERE status = 'running'`);
		const completedStmt = this.db.prepare(`SELECT count(*) as c FROM jobs WHERE status = 'completed'`);
		const failedStmt = this.db.prepare(`SELECT count(*) as c FROM jobs WHERE status = 'failed'`);
		const stage1Stmt = this.db.prepare(`SELECT count(*) as c FROM stage1_outputs WHERE selected_for_phase2 = 0`);

		return {
			pending: Number((pendingStmt.get() as any)?.c ?? 0),
			running: Number((runningStmt.get() as any)?.c ?? 0),
			completed: Number((completedStmt.get() as any)?.c ?? 0),
			failed: Number((failedStmt.get() as any)?.c ?? 0),
			unconsolidatedStage1: Number((stage1Stmt.get() as any)?.c ?? 0),
		};
	}
}
