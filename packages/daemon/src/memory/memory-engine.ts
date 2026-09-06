/**
 * Memory Engine: Lifecycle Coordinator for Two-Stage Memory Pipeline.
 *
 * Runs inside the OpenPI daemon:
 * - Listens for session completion (agent_settled, stop) to enqueue Stage 1 extraction
 * - Background worker ticks SQLite jobs queue using lease-based atomic claims
 * - Handles Stage 1 (Thread Extraction) and Phase 2 (Global Consolidation)
 * - Exposes high-level data APIs for Desktop UI and RPC
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoriesDir, rolloutSummariesDir, skillsDir } from "../config.ts";
import { type JobStats, type MemoryJob, MemoryDb } from "./memory-db.ts";
import { runPhase2Consolidation } from "./phase2-worker.ts";
import { runStage1Worker } from "./stage1-worker.ts";

export interface RolloutSummaryItem {
	slug: string;
	fileName: string;
	date: string;
	content: string;
}

export interface SkillItem {
	name: string;
	content: string;
}

export interface MemoryHubData {
	summary: string;
	handbook: string;
	rolloutSummaries: RolloutSummaryItem[];
	skills: SkillItem[];
	stats: JobStats;
	recentJobs: MemoryJob[];
}

export class MemoryEngine {
	private static instance?: MemoryEngine;
	private db: MemoryDb;
	private timer?: NodeJS.Timeout;
	private ticking = false;
	private workerId: string;

	constructor(db?: MemoryDb) {
		this.db = db ?? new MemoryDb();
		this.workerId = `daemon-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
	}

	public static get(): MemoryEngine {
		if (!MemoryEngine.instance) {
			MemoryEngine.instance = new MemoryEngine();
		}
		return MemoryEngine.instance;
	}

	public start(intervalMs = 12_000): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			this.tick().catch(() => {});
		}, intervalMs);
		this.timer.unref?.();
		// Kick off initial tick after startup
		setTimeout(() => this.tick().catch(() => {}), 1000).unref?.();
	}

	public stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	public getDb(): MemoryDb {
		return this.db;
	}

	/**
	 * Enqueue Stage 1 Extraction for a settled or finished session.
	 * Returns immediately; extraction runs asynchronously.
	 */
	public enqueueStage1(sessionId: string): void {
		this.db.enqueueJob("memory_stage1", sessionId);
		// Trigger non-blocking tick
		setTimeout(() => this.tick().catch(() => {}), 500).unref?.();
	}

	/**
	 * Trigger Phase 2 Global Consolidation manually or via schedule.
	 */
	public triggerConsolidation(force = false): void {
		this.db.enqueueJob("memory_consolidate_global", "global");
		setTimeout(() => this.tick(force).catch(() => {}), 100).unref?.();
	}

	/**
	 * Single tick of the background worker: claims a job and executes it.
	 */
	public async tick(forceConsolidation = false): Promise<boolean> {
		if (this.ticking) return false;
		this.ticking = true;

		try {
			const claimed = this.db.claimNextJob(this.workerId, undefined, 45_000);
			if (!claimed) return false;

			const { job, ownershipToken } = claimed;

			// Heartbeat timer to renew lease for long LLM calls
			const renewTimer = setInterval(() => {
				this.db.renewLease(job.kind, job.job_key, ownershipToken, 45_000);
			}, 15_000);
			renewTimer.unref?.();

			try {
				if (job.kind === "memory_stage1") {
					await runStage1Worker(job.job_key, this.db);
					this.db.completeJob(job.kind, job.job_key, ownershipToken);
				} else if (job.kind === "memory_consolidate_global") {
					await runPhase2Consolidation(this.db, { force: forceConsolidation });
					this.db.completeJob(job.kind, job.job_key, ownershipToken);
				}
				return true;
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : String(err);
				this.db.failJob(job.kind, job.job_key, ownershipToken, errorMsg, 20_000);
				return false;
			} finally {
				clearInterval(renewTimer);
			}
		} finally {
			this.ticking = false;
		}
	}

	/**
	 * Retrieve all data for the Desktop Memory Hub interface.
	 */
	public getMemoryHub(cwd?: string): MemoryHubData {
		const dir = memoriesDir();
		mkdirSync(dir, { recursive: true });

		const handbookPath = join(dir, "MEMORY.md");
		const summaryPath = join(dir, "memory_summary.md");

		const handbook = existsSync(handbookPath) ? readFileSync(handbookPath, "utf8") : "";
		const summary = existsSync(summaryPath) ? readFileSync(summaryPath, "utf8") : "";

		// Rollout summaries
		const rolloutSummaries: RolloutSummaryItem[] = [];
		const rDir = rolloutSummariesDir();
		if (existsSync(rDir)) {
			try {
				const files = readdirSync(rDir)
					.filter((f) => f.endsWith(".md"))
					.sort()
					.reverse();
				for (const file of files.slice(0, 30)) {
					const filePath = join(rDir, file);
					const content = readFileSync(filePath, "utf8");
					const date = file.slice(0, 10);
					const slug = file.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
					rolloutSummaries.push({ slug, fileName: file, date, content });
				}
			} catch {}
		}

		// Skills
		const skills: SkillItem[] = [];
		const sDir = skillsDir();
		if (existsSync(sDir)) {
			try {
				for (const item of readdirSync(sDir, { withFileTypes: true })) {
					if (item.isDirectory()) {
						const skillFile = join(sDir, item.name, "SKILL.md");
						if (existsSync(skillFile)) {
							skills.push({
								name: item.name,
								content: readFileSync(skillFile, "utf8"),
							});
						}
					}
				}
			} catch {}
		}

		const stats = this.db.getJobStats();
		const recentJobs = this.db.listJobs(10);

		return {
			summary,
			handbook,
			rolloutSummaries,
			skills,
			stats,
			recentJobs,
		};
	}

	/**
	 * Direct manual update of MEMORY.md from UI editor.
	 */
	public saveHandbook(content: string, cwd?: string): boolean {
		const dir = memoriesDir();
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "MEMORY.md"), content, "utf8");

		// If cwd provided, mirror to workspace
		if (cwd && existsSync(cwd)) {
			try {
				const projectDir = join(cwd, ".pi", "memory");
				mkdirSync(projectDir, { recursive: true });
				writeFileSync(join(projectDir, "MEMORY.md"), content, "utf8");
			} catch {}
		}

		// Automatically re-consolidate summary to keep index in sync
		this.triggerConsolidation(true);
		return true;
	}
}
