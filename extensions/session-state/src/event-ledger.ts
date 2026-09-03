/**
 * Event ledger for observability.
 *
 * One JSON line per event under `<cwd>/.pi/events/<sessionId>.jsonl`, so the
 * desktop can reconstruct what a session did, how long each tool took, and
 * where it failed. Per-session files replace the old shared `events.jsonl`,
 * which grew without bound and mixed every session in a directory together.
 *
 * Writes are append-only and best-effort: losing an event must never fail a
 * tool call.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export type LedgerEventType =
	| "session_start"
	| "session_end"
	| "tool_call"
	| "tool_result"
	| "tool_error"
	| "checkpoint_save"
	| "compaction"
	| "task_update";

export interface LedgerEvent {
	version: 1;
	type: LedgerEventType;
	at: string;
	sessionId: string;
	data: Record<string, unknown>;
}

/** Beyond this, appends stop rather than growing a file the desktop cannot load. */
const MAX_LEDGER_BYTES = 32 * 1024 * 1024;

export function eventsDir(cwd: string): string {
	return join(cwd, ".pi", "events");
}

export function eventFilePath(cwd: string, sessionId: string): string {
	return join(eventsDir(cwd), `${sessionId}.jsonl`);
}

export function appendEvent(cwd: string, event: LedgerEvent): void {
	const file = eventFilePath(cwd, event.sessionId);
	try {
		mkdirSync(dirname(file), { recursive: true });
		if (existsSync(file) && statSync(file).size > MAX_LEDGER_BYTES) return;
		appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
	} catch {
		// Observability must never break the session.
	}
}

function event(sessionId: string, type: LedgerEventType, data: Record<string, unknown>): LedgerEvent {
	return { version: 1, type, at: new Date().toISOString(), sessionId, data };
}

export function sessionStartEvent(sessionId: string, cwd: string, model?: string): LedgerEvent {
	return event(sessionId, "session_start", { cwd, model });
}

export function sessionEndEvent(sessionId: string, durationMs: number): LedgerEvent {
	return event(sessionId, "session_end", { durationMs });
}

export function toolCallEvent(sessionId: string, toolName: string, input: unknown): LedgerEvent {
	return event(sessionId, "tool_call", { toolName, input: summarizeInput(input) });
}

export function toolResultEvent(
	sessionId: string,
	toolName: string,
	options: { durationMs?: number; isError: boolean; resultBytes?: number },
): LedgerEvent {
	return event(sessionId, options.isError ? "tool_error" : "tool_result", {
		toolName,
		durationMs: options.durationMs,
		resultBytes: options.resultBytes,
	});
}

export function compactionEvent(
	sessionId: string,
	options: { reason: string; tokensBefore: number; fromExtension: boolean },
): LedgerEvent {
	return event(sessionId, "compaction", { ...options });
}

export function checkpointSaveEvent(sessionId: string, options: { goal: string; steps: number }): LedgerEvent {
	return event(sessionId, "checkpoint_save", { ...options });
}

export function taskUpdateEvent(
	sessionId: string,
	options: { goal: string; status: string; completed: number; total: number },
): LedgerEvent {
	return event(sessionId, "task_update", { ...options });
}

export function readEvents(cwd: string, sessionId: string, options: { limit?: number } = {}): LedgerEvent[] {
	const file = eventFilePath(cwd, sessionId);
	if (!existsSync(file)) return [];
	try {
		const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
		const selected = options.limit ? lines.slice(-options.limit) : lines;
		const events: LedgerEvent[] = [];
		for (const line of selected) {
			try {
				events.push(JSON.parse(line) as LedgerEvent);
			} catch {
				// Skip a torn final line rather than failing the whole read.
			}
		}
		return events;
	} catch {
		return [];
	}
}

/**
 * Tool inputs can hold a whole file's contents. Record enough to identify the
 * call, never the payload: the ledger is written on every tool call, and a full
 * copy would both bloat the file and duplicate content that already lives in
 * the session transcript.
 */
function summarizeInput(input: unknown): Record<string, unknown> {
	if (!input || typeof input !== "object") return {};
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (typeof value === "string") {
			out[key] = value.length > 200 ? `${value.slice(0, 200)}… (${value.length} chars)` : value;
		} else if (typeof value === "number" || typeof value === "boolean" || value === null) {
			out[key] = value;
		} else if (Array.isArray(value)) {
			out[key] = `[${value.length} items]`;
		} else {
			out[key] = "[object]";
		}
	}
	return out;
}
