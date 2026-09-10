/**
 * Session instance pool.
 *
 * Holds one RpcProcess per live session, persists a lightweight record so the
 * list survives a daemon restart, and fans session events out to subscribers.
 *
 * Scheduled tasks deliberately do NOT live here - in the old OpenPI the
 * orchestrator owned both the session pool and the cron engine, which made ~4400
 * lines of unrelated concerns share a lifecycle. The scheduler is its own package.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { join } from "node:path";
import type { PiRpcCommand, PiRpcEvent, SessionInfo, SessionMode } from "@openpi/shared";
import { instancesPath, openpiDir, sessionsDir } from "./config.ts";
import { MemoryEngine } from "./memory/memory-engine.ts";
import { RpcProcess } from "./rpc-process.ts";

interface SessionRecord {
	sessionId: string;
	cwd: string;
	mode: SessionMode;
	name?: string;
	model?: string;
	createdAt: string;
	updatedAt: string;
}

export type SessionEventListener = (sessionId: string, event: PiRpcEvent) => void;

interface WarmProcessEntry {
	process: RpcProcess;
	cwd: string;
	mode: SessionMode;
	model?: string;
	sessionId: string;
}

export interface SupervisorOptions {
	maxLiveProcesses?: number;
	idleTimeoutMs?: number;
	enableWarmPool?: boolean;
}

export class Supervisor {
	private readonly records = new Map<string, SessionRecord>();
	private readonly live = new Map<string, RpcProcess>();
	/** Sessions whose process we killed on purpose, so its exit is not reported as a crash. */
	private readonly suspended = new Set<string>();
	private readonly subscribers = new Map<string, Set<SessionEventListener>>();
	private readonly lastActive = new Map<string, number>();
	private readonly working = new Set<string>();
	private readonly maxLiveProcesses: number;
	private readonly idleTimeoutMs: number;
	private readonly enableWarmPool: boolean;
	private warmProcess: WarmProcessEntry | undefined;
	private warmRefillTimer: NodeJS.Timeout | undefined;
	private idleReaperTimer: NodeJS.Timeout | undefined;

	constructor(options?: SupervisorOptions) {
		const envMax = Number(process.env.OPENPI_MAX_LIVE_SESSIONS);
		const defaultMax = (() => {
			try {
				const totalMemGb = totalmem() / (1024 * 1024 * 1024);
				if (totalMemGb >= 32) return 6;
				if (totalMemGb >= 16) return 4;
				return 2;
			} catch {
				return 2;
			}
		})();
		this.maxLiveProcesses = options?.maxLiveProcesses ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : defaultMax);
		const envIdle = Number(process.env.OPENPI_IDLE_TIMEOUT_MS);
		this.idleTimeoutMs = options?.idleTimeoutMs ?? (Number.isFinite(envIdle) && envIdle >= 0 ? envIdle : 120_000);
		this.enableWarmPool = options?.enableWarmPool ?? (process.env.OPENPI_WARM_POOL === "1");

		mkdirSync(openpiDir(), { recursive: true });
		mkdirSync(sessionsDir(), { recursive: true });
		this.loadRecords();
		this.startIdleReaper();
	}

	list(): SessionInfo[] {
		return [...this.records.values()]
			.map((record) => ({ ...record, running: this.live.get(record.sessionId)?.running === true }))
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	create(options: { cwd: string; mode?: SessionMode; model?: string; name?: string; eager?: boolean }): SessionInfo {
		const targetMode = options.mode ?? "chat";
		let sessionId: string;
		let claimedProcess: RpcProcess | undefined;

		if (
			options.eager !== false &&
			this.enableWarmPool &&
			this.warmProcess &&
			this.warmProcess.process.running &&
			this.warmProcess.cwd === options.cwd &&
			this.warmProcess.mode === targetMode &&
			this.warmProcess.model === options.model
		) {
			const warm = this.warmProcess;
			this.warmProcess = undefined;
			sessionId = warm.sessionId;
			claimedProcess = warm.process;
		} else {
			sessionId = randomUUID();
		}

		const now = new Date().toISOString();
		const record: SessionRecord = {
			sessionId,
			cwd: options.cwd,
			mode: targetMode,
			model: options.model,
			name: options.name,
			createdAt: now,
			updatedAt: now,
		};
		this.records.set(sessionId, record);
		this.saveRecords();

		if (claimedProcess) {
			this.attachLiveProcess(sessionId, claimedProcess);
			this.scheduleWarmRefill(options.cwd, targetMode, options.model);
			return { ...record, running: true };
		}

		if (options.eager !== false) {
			this.ensureLive(sessionId);
			this.scheduleWarmRefill(options.cwd, targetMode, options.model);
			return { ...record, running: true };
		}
		return { ...record, running: false };
	}

	/** Forward a command to a session, waking a suspended one on demand. */
	async rpc(sessionId: string, command: PiRpcCommand): Promise<unknown> {
		this.lastActive.set(sessionId, Date.now());
		if (command.type === "prompt") {
			this.working.add(sessionId);
		} else if (command.type === "abort") {
			this.working.delete(sessionId);
		}
		const process_ = this.ensureLive(sessionId);
		try {
			const result = await process_.send(command);
			this.touch(sessionId);
			return result;
		} catch (error) {
			if (command.type === "prompt") {
				this.working.delete(sessionId);
			}
			throw error;
		}
	}

	subscribe(sessionId: string, listener: SessionEventListener): () => void {
		if (!this.records.has(sessionId)) throw new Error(`unknown session ${sessionId}`);
		// Subscribing wakes the session so events start flowing immediately.
		this.ensureLive(sessionId);
		let set = this.subscribers.get(sessionId);
		if (!set) {
			set = new Set();
			this.subscribers.set(sessionId, set);
		}
		set.add(listener);
		return () => {
			set.delete(listener);
			if (set.size === 0) this.subscribers.delete(sessionId);
		};
	}

	/** Suspend a session's process but keep its record and session file. */
	stop(sessionId: string): void {
		const process_ = this.live.get(sessionId);
		if (!process_) return;
		this.suspended.add(sessionId);
		this.live.delete(sessionId);
		this.working.delete(sessionId);
		this.lastActive.delete(sessionId);
		process_.stop();
	}

	/**
	 * Rename a session.
	 *
	 * Updates our record and, when the session is live, tells pi too - upstream
	 * stores its own session name, and leaving the two to disagree means a resumed
	 * session shows the old one.
	 */
	async rename(sessionId: string, name: string): Promise<SessionInfo> {
		const record = this.records.get(sessionId);
		if (!record) throw new Error(`unknown session ${sessionId}`);
		record.name = name;
		record.updatedAt = new Date().toISOString();
		this.saveRecords();
		const live = this.live.get(sessionId);
		if (live?.running) {
			await live.send({ type: "set_session_name", name }).catch(() => undefined);
		}
		return { ...record, running: live?.running === true };
	}

	delete(sessionId: string): void {
		this.stop(sessionId);
		this.records.delete(sessionId);
		this.saveRecords();
		try {
			const file = join(sessionsDir(), `${sessionId}.jsonl`);
			if (existsSync(file)) unlinkSync(file);
		} catch {}
	}

	stopAll(): void {
		if (this.idleReaperTimer) {
			clearInterval(this.idleReaperTimer);
			this.idleReaperTimer = undefined;
		}
		if (this.warmRefillTimer) {
			clearTimeout(this.warmRefillTimer);
			this.warmRefillTimer = undefined;
		}
		if (this.warmProcess) {
			this.warmProcess.process.stop();
			this.warmProcess = undefined;
		}
		for (const sessionId of [...this.live.keys()]) this.stop(sessionId);
	}

	get runningCount(): number {
		return this.live.size;
	}

	get sessionCount(): number {
		return this.records.size;
	}

	hasRunningSessions(): boolean {
		return this.live.size > 0;
	}

	scheduleWarmRefill(cwd: string, mode: SessionMode = "chat", model?: string): void {
		if (!this.enableWarmPool) return;
		if (this.warmRefillTimer) clearTimeout(this.warmRefillTimer);
		this.warmRefillTimer = setTimeout(() => {
			this.refillWarmProcess(cwd, mode, model);
		}, 300);
		this.warmRefillTimer.unref();
	}

	refillWarmProcess(cwd: string, mode: SessionMode = "chat", model?: string): void {
		if (!this.enableWarmPool) return;
		if (this.live.size >= this.maxLiveProcesses) return;

		if (
			this.warmProcess &&
			this.warmProcess.process.running &&
			this.warmProcess.cwd === cwd &&
			this.warmProcess.mode === mode &&
			this.warmProcess.model === model
		) {
			return;
		}

		if (this.warmProcess) {
			const old = this.warmProcess.process;
			this.warmProcess = undefined;
			old.stop();
		}

		const warmSessionId = randomUUID();
		try {
			const warm = new RpcProcess({
				sessionId: warmSessionId,
				cwd,
				mode,
				model,
				sessionFile: join(sessionsDir(), `${warmSessionId}.jsonl`),
			});
			warm.send({ type: "set_auto_compaction", enabled: true }).catch(() => undefined);
			warm.onExit(() => {
				if (this.warmProcess?.sessionId === warmSessionId) {
					this.warmProcess = undefined;
				}
			});
			this.warmProcess = {
				process: warm,
				cwd,
				mode,
				model,
				sessionId: warmSessionId,
			};
		} catch {
			// ignore warm spawn error
		}
	}

	isWarmReady(cwd?: string): boolean {
		return Boolean(
			this.warmProcess &&
			this.warmProcess.process.running &&
			(!cwd || this.warmProcess.cwd === cwd),
		);
	}

	private attachLiveProcess(sessionId: string, process_: RpcProcess): void {
		this.lastActive.set(sessionId, Date.now());
		process_.onEvent((event) => this.broadcast(sessionId, event));
		process_.setUiRequestHandler((request) => this.broadcast(sessionId, request));
		process_.onExit((code) => {
			if (this.live.get(sessionId) === process_) {
				this.live.delete(sessionId);
				this.working.delete(sessionId);
				this.lastActive.delete(sessionId);
			}
			if (!this.suspended.delete(sessionId)) {
				this.broadcast(sessionId, { type: "session_exit", sessionId, code });
			}
		});
		this.live.set(sessionId, process_);
	}

	private ensureLive(sessionId: string): RpcProcess {
		const existing = this.live.get(sessionId);
		if (existing?.running) {
			this.lastActive.set(sessionId, Date.now());
			return existing;
		}

		const record = this.records.get(sessionId);
		if (!record) throw new Error(`unknown session ${sessionId}`);

		// Evict least recently used idle session if at capacity
		while (this.live.size >= this.maxLiveProcesses) {
			const evicted = this.evictLeastRecentlyUsed(sessionId);
			if (!evicted) break;
		}

		const process_ = new RpcProcess({
			sessionId,
			cwd: record.cwd,
			mode: record.mode,
			model: record.model,
			sessionFile: join(sessionsDir(), `${sessionId}.jsonl`),
		});
		// Enable auto-compaction by default to protect context window limits
		process_.send({ type: "set_auto_compaction", enabled: true }).catch(() => undefined);
		this.attachLiveProcess(sessionId, process_);
		return process_;
	}

	private broadcast(sessionId: string, event: PiRpcEvent): void {
		this.lastActive.set(sessionId, Date.now());
		const type = event.type;
		if (type === "turn_start" || type === "agent_start") {
			this.working.add(sessionId);
		} else if (
			type === "turn_end" ||
			type === "agent_end" ||
			type === "agent_settled" ||
			type === "error" ||
			type === "session_exit"
		) {
			this.working.delete(sessionId);
			if (type === "agent_settled") {
				try {
					MemoryEngine.get().enqueueStage1(sessionId);
				} catch {}
			}
		}
		const set = this.subscribers.get(sessionId);
		if (!set) return;
		for (const listener of set) {
			try {
				listener(sessionId, event);
			} catch (error) {
				// One bad subscriber must not stop the others from seeing the event.
				process.stderr.write(`[supervisor] subscriber error: ${String(error)}\n`);
			}
		}
	}

	private evictLeastRecentlyUsed(excludeSessionId: string): boolean {
		const candidates: Array<{ sessionId: string; lastActive: number }> = [];
		const now = Date.now();
		for (const [id, proc] of this.live) {
			if (id === excludeSessionId) continue;
			if (this.working.has(id)) {
				const last = this.lastActive.get(id) ?? 0;
				if (now - last > 60_000) {
					this.working.delete(id);
				} else {
					continue;
				}
			}
			if (!proc.running) {
				this.live.delete(id);
				continue;
			}
			const last = this.lastActive.get(id) ?? 0;
			candidates.push({ sessionId: id, lastActive: last });
		}
		if (candidates.length === 0) return false;
		candidates.sort((a, b) => a.lastActive - b.lastActive);
		const victim = candidates[0];
		if (victim) {
			this.stop(victim.sessionId);
			return true;
		}
		return false;
	}

	private startIdleReaper(): void {
		if (this.idleTimeoutMs <= 0) return;
		this.idleReaperTimer = setInterval(() => {
			this.reapIdleProcesses();
		}, 15_000);
		this.idleReaperTimer.unref();
	}

	reapIdleProcesses(): number {
		const now = Date.now();
		let reaped = 0;
		for (const [id, proc] of this.live) {
			if (this.working.has(id)) continue;
			if (!proc.running) continue;
			const last = this.lastActive.get(id) ?? 0;
			if (now - last >= this.idleTimeoutMs) {
				this.stop(id);
				reaped++;
			}
		}
		return reaped;
	}

	isWorking(sessionId: string): boolean {
		return this.working.has(sessionId);
	}

	getLastActive(sessionId: string): number | undefined {
		return this.lastActive.get(sessionId);
	}

	private touch(sessionId: string): void {
		const record = this.records.get(sessionId);
		if (!record) return;
		record.updatedAt = new Date().toISOString();
		this.saveRecords();
	}

	private loadRecords(): void {
		const file = instancesPath();
		if (!existsSync(file)) return;
		try {
			const parsed = JSON.parse(readFileSync(file, "utf8")) as SessionRecord[];
			for (const record of parsed) this.records.set(record.sessionId, record);
		} catch (error) {
			process.stderr.write(`[supervisor] could not read instances.json: ${String(error)}\n`);
		}
	}

	private saveRecords(): void {
		// Write-then-rename so a crash mid-write cannot truncate the list.
		const file = instancesPath();
		const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
		writeFileSync(temp, JSON.stringify([...this.records.values()], null, 2), "utf8");
		renameSync(temp, file);
	}
}
