/**
 * Event ledger for agent observability.
 *
 * Persists structured events to `<cwd>/.pi/events/events.jsonl` so that
 * the desktop UI (or any consumer) can reconstruct what the agent did,
 * how long each step took, and where errors occurred.
 *
 * Event schema is intentionally simple — one JSON line per event.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type EventType =
	| "task_start"
	| "task_step"
	| "task_complete"
	| "task_error"
	| "tool_call"
	| "tool_result"
	| "tool_error"
	| "checkpoint_save"
	| "compaction"
	| "session_start"
	| "session_end";

export interface AgentEvent {
	version: 1;
	id: string;
	type: EventType;
	timestamp: string;
	cwd: string;
	sessionId?: string;
	data: Record<string, unknown>;
}

function generateId(): string {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function eventFilePath(cwd: string): string {
	return join(cwd, ".pi", "events", "events.jsonl");
}

function ensureEventDir(filePath: string): void {
	const dir = join(filePath, "..");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function appendEvent(filePath: string, event: AgentEvent): void {
	ensureEventDir(filePath);
	appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
}

export function toolCallEvent(cwd: string, sessionId: string | undefined, toolName: string, args: unknown): AgentEvent {
	return {
		version: 1,
		id: generateId(),
		type: "tool_call",
		timestamp: new Date().toISOString(),
		cwd,
		sessionId,
		data: { toolName, args },
	};
}

export function toolResultEvent(
	cwd: string,
	sessionId: string | undefined,
	toolName: string,
	durationMs: number,
	success: boolean,
	resultSize?: number,
): AgentEvent {
	return {
		version: 1,
		id: generateId(),
		type: success ? "tool_result" : "tool_error",
		timestamp: new Date().toISOString(),
		cwd,
		sessionId,
		data: { toolName, durationMs, success, resultSize },
	};
}

export function taskStartEvent(cwd: string, sessionId: string | undefined, goal: string): AgentEvent {
	return {
		version: 1,
		id: generateId(),
		type: "task_start",
		timestamp: new Date().toISOString(),
		cwd,
		sessionId,
		data: { goal },
	};
}

export function taskStepEvent(
	cwd: string,
	sessionId: string | undefined,
	step: string,
	stepIndex: number,
	totalSteps?: number,
): AgentEvent {
	return {
		version: 1,
		id: generateId(),
		type: "task_step",
		timestamp: new Date().toISOString(),
		cwd,
		sessionId,
		data: { step, stepIndex, totalSteps },
	};
}

export function taskCompleteEvent(cwd: string, sessionId: string | undefined, durationMs: number): AgentEvent {
	return {
		version: 1,
		id: generateId(),
		type: "task_complete",
		timestamp: new Date().toISOString(),
		cwd,
		sessionId,
		data: { durationMs },
	};
}

export function compactionEvent(
	cwd: string,
	sessionId: string | undefined,
	reason: string,
	tokensBefore: number,
): AgentEvent {
	return {
		version: 1,
		id: generateId(),
		type: "compaction",
		timestamp: new Date().toISOString(),
		cwd,
		sessionId,
		data: { reason, tokensBefore },
	};
}

export function readEvents(filePath: string): AgentEvent[] {
	if (!existsSync(filePath)) return [];
	try {
		const lines = readFileSync(filePath, "utf8").split("\n").filter(Boolean);
		return lines.map((line: string) => JSON.parse(line) as AgentEvent);
	} catch {
		return [];
	}
}
