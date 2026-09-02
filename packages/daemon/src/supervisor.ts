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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PiRpcCommand, PiRpcEvent, SessionInfo, SessionMode } from "@openpi/shared";
import { instancesPath, openpiDir, sessionsDir } from "./config.ts";
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

export class Supervisor {
	private readonly records = new Map<string, SessionRecord>();
	private readonly live = new Map<string, RpcProcess>();
	private readonly subscribers = new Map<string, Set<SessionEventListener>>();

	constructor() {
		mkdirSync(openpiDir(), { recursive: true });
		mkdirSync(sessionsDir(), { recursive: true });
		this.loadRecords();
	}

	list(): SessionInfo[] {
		return [...this.records.values()]
			.map((record) => ({ ...record, running: this.live.get(record.sessionId)?.running === true }))
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	create(options: { cwd: string; mode?: SessionMode; model?: string; name?: string }): SessionInfo {
		const sessionId = randomUUID();
		const now = new Date().toISOString();
		const record: SessionRecord = {
			sessionId,
			cwd: options.cwd,
			mode: options.mode ?? "chat",
			model: options.model,
			name: options.name,
			createdAt: now,
			updatedAt: now,
		};
		this.records.set(sessionId, record);
		this.saveRecords();
		this.ensureLive(sessionId);
		return { ...record, running: true };
	}

	/** Forward a command to a session, waking a suspended one on demand. */
	async rpc(sessionId: string, command: PiRpcCommand): Promise<unknown> {
		const process_ = this.ensureLive(sessionId);
		const result = await process_.send(command);
		this.touch(sessionId);
		return result;
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
		this.live.get(sessionId)?.stop();
		this.live.delete(sessionId);
	}

	delete(sessionId: string): void {
		this.stop(sessionId);
		this.records.delete(sessionId);
		this.saveRecords();
	}

	stopAll(): void {
		for (const [, process_] of this.live) process_.stop();
		this.live.clear();
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

	private ensureLive(sessionId: string): RpcProcess {
		const existing = this.live.get(sessionId);
		if (existing?.running) return existing;

		const record = this.records.get(sessionId);
		if (!record) throw new Error(`unknown session ${sessionId}`);

		const process_ = new RpcProcess({
			sessionId,
			cwd: record.cwd,
			mode: record.mode,
			model: record.model,
			sessionFile: join(sessionsDir(), `${sessionId}.jsonl`),
		});
		process_.onEvent((event) => this.broadcast(sessionId, event));
		// A UI request that nobody answers would hang the agent turn, so surface
		// it as an event and let the desktop reply through the normal rpc path.
		process_.setUiRequestHandler((request) => this.broadcast(sessionId, request));
		process_.onExit(() => {
			this.live.delete(sessionId);
			this.broadcast(sessionId, { type: "session_exit", sessionId });
		});
		this.live.set(sessionId, process_);
		return process_;
	}

	private broadcast(sessionId: string, event: PiRpcEvent): void {
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
		const temp = `${file}.tmp`;
		writeFileSync(temp, JSON.stringify([...this.records.values()], null, 2), "utf8");
		renameSync(temp, file);
	}
}
