/**
 * TypeScript wrapper for pi-storage Rust binary.
 * Falls back to native TS implementations if binary not found.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as tsCheckpoint from "./context-checkpoint.ts";
import * as tsEventLedger from "./event-ledger.ts";
import * as tsTaskState from "./task-state.ts";

const BIN_PATHS = [
	join(import.meta.dirname ?? ".", "../../../pi-storage/target/release/pi-storage-cli"),
	join(import.meta.dirname ?? ".", "../pi-storage/target/release/pi-storage-cli"),
	"/usr/local/bin/pi-storage-cli",
];

function findBinary(): string | null {
	for (const p of BIN_PATHS) {
		if (existsSync(p)) return p;
	}
	return null;
}

const BIN = findBinary();

interface CliResult {
	ok: boolean;
	data?: unknown;
	error?: string;
	elapsed_ms?: number;
}

function cliCall(cmd: unknown): CliResult | null {
	if (!BIN) return null;
	try {
		const result = spawnSync(BIN, {
			input: JSON.stringify(cmd),
			encoding: "utf8",
			timeout: 5000,
		});
		if (result.status !== 0 || result.error) {
			return null;
		}
		return JSON.parse(result.stdout) as CliResult;
	} catch {
		return null;
	}
}

// ── Task State ──────────────────────────────────────────────
export function loadTaskState(cwd: string): tsTaskState.TaskState | undefined {
	const r = cliCall({ cmd: "task_state_load", path: tsTaskState.taskStatePath(cwd) });
	if (r?.ok && r.data) return r.data as tsTaskState.TaskState;
	return tsTaskState.loadTaskState(cwd);
}

export function saveTaskState(cwd: string, state: tsTaskState.TaskState): void {
	const r = cliCall({ cmd: "task_state_save", path: tsTaskState.taskStatePath(cwd), state });
	if (r?.ok) return;
	tsTaskState.saveTaskState(cwd, state);
}

export function formatTaskState(state: tsTaskState.TaskState | undefined): string {
	const r = cliCall({ cmd: "task_state_format", state });
	if (r?.ok && typeof r.data === "string") return r.data as string;
	return tsTaskState.formatTaskState(state);
}

export function compactTaskState(state: tsTaskState.TaskState | undefined): string {
	const r = cliCall({ cmd: "task_state_compact", state });
	if (r?.ok && typeof r.data === "string") return r.data as string;
	return tsTaskState.compactTaskState(state);
}

// ── Event Ledger ────────────────────────────────────────────
export function appendEvent(filePath: string, event: tsEventLedger.AgentEvent): void {
	const r = cliCall({ cmd: "event_append", path: filePath, event });
	if (r?.ok) return;
	tsEventLedger.appendEvent(filePath, event);
}

export function readEvents(filePath: string): tsEventLedger.AgentEvent[] {
	const r = cliCall({ cmd: "event_read", path: filePath });
	if (r?.ok && Array.isArray(r.data)) return r.data as tsEventLedger.AgentEvent[];
	return tsEventLedger.readEvents(filePath);
}

// ── Context Checkpoint ──────────────────────────────────────
export function loadCheckpoint(cwd: string): tsCheckpoint.ContextCheckpoint | undefined {
	const r = cliCall({ cmd: "checkpoint_load", path: tsCheckpoint.checkpointPath(cwd) });
	if (r?.ok && r.data) return r.data as tsCheckpoint.ContextCheckpoint;
	return tsCheckpoint.loadCheckpoint(cwd);
}

export function saveCheckpoint(cwd: string, checkpoint: tsCheckpoint.ContextCheckpoint): void {
	const r = cliCall({ cmd: "checkpoint_save", path: tsCheckpoint.checkpointPath(cwd), checkpoint });
	if (r?.ok) return;
	tsCheckpoint.saveCheckpoint(cwd, checkpoint);
}

export function formatCheckpoint(checkpoint: tsCheckpoint.ContextCheckpoint): string {
	const r = cliCall({ cmd: "checkpoint_format", checkpoint });
	if (r?.ok && typeof r.data === "string") return r.data as string;
	return tsCheckpoint.formatCheckpoint(checkpoint);
}

export function compactCheckpoint(checkpoint: tsCheckpoint.ContextCheckpoint): string {
	const r = cliCall({ cmd: "checkpoint_compact", checkpoint });
	if (r?.ok && typeof r.data === "string") return r.data as string;
	return tsCheckpoint.compactCheckpoint(checkpoint);
}

export { findBinary };

// Re-export helpers that agent-session needs directly
export {
	compactionEvent,
	eventFilePath,
	taskCompleteEvent,
	taskStartEvent,
	taskStepEvent,
	toolCallEvent,
	toolResultEvent,
} from "./event-ledger.ts";
