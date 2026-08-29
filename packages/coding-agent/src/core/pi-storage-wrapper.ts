/**
 * TypeScript wrapper for pi-storage Rust binary.
 * Uses persistent server mode when available, falls back to CLI or TS.
 */
import { existsSync } from "node:fs";
import net from "node:net";
import { join } from "node:path";

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
const SERVER_PORT = 8766;

// ── Server connection (persistent) ─────────────────────────
let serverSocket: net.Socket | null = null;
let serverConnected = false;

function getServerSocket(): Promise<net.Socket> {
	if (serverSocket && serverConnected) {
		return Promise.resolve(serverSocket);
	}
	return new Promise((resolve, reject) => {
		const sock = new net.Socket();
		const timeout = setTimeout(() => {
			sock.destroy();
			reject(new Error("Server connect timeout"));
		}, 3000);
		sock.connect(SERVER_PORT, "127.0.0.1", () => {
			clearTimeout(timeout);
			serverSocket = sock;
			serverConnected = true;
			resolve(sock);
		});
		sock.on("error", () => {
			clearTimeout(timeout);
			serverConnected = false;
			resolve(createFallbackSocket());
		});
	});
}

function createFallbackSocket(): net.Socket {
	const { execSync } = require("node:child_process");
	return {
		write: (data: string) => {
			const input = JSON.stringify(JSON.parse(data));
			execSync(`echo '${input.replace(/'/g, "'\\''")}' | ${BIN}`, { encoding: "utf8" });
			return true;
		},
		end: () => {},
		destroy: () => {},
		on: () => {},
		connect: () => {},
	} as unknown as net.Socket;
}

interface ServerRequest {
	cmd: string;
	[k: string]: unknown;
}
interface ServerResponse {
	ok: boolean;
	data?: unknown;
	error?: string;
	elapsed_ms: number;
}

async function sendToServer<T>(cmd: string, args: Record<string, unknown>): Promise<T | null> {
	if (!BIN) return null;
	try {
		const sock = await getServerSocket();
		return new Promise<T | null>((resolve) => {
			const request: ServerRequest = { cmd, ...args };
			const data = `${JSON.stringify(request)}\n`;
			sock.write(data);
			let responseData = "";
			sock.once("data", (chunk: Buffer) => {
				responseData += chunk.toString();
				try {
					const resp = JSON.parse(responseData) as ServerResponse;
					if (resp.ok && resp.data !== undefined) {
						resolve(resp.data as T);
					} else {
						resolve(null);
					}
				} catch {
					resolve(null);
				}
			});
			setTimeout(() => resolve(null), 3000);
		});
	} catch {
		return null;
	}
}

// ── CLI fallback ────────────────────────────────────────────
function cliCall<T>(cmd: string, args: Record<string, unknown>): T | null {
	if (!BIN) return null;
	try {
		const { spawnSync } = require("node:child_process");
		const input = JSON.stringify({ cmd, ...args });
		const result = spawnSync(BIN, { input, encoding: "utf8", timeout: 5000 });
		if (result.status !== 0 || result.error) return null;
		const resp = JSON.parse(result.stdout) as { ok: boolean; data?: T; error?: string };
		if (resp.ok && resp.data !== undefined) return resp.data;
		return null;
	} catch {
		return null;
	}
}

// ── Helpers ─────────────────────────────────────────────────
async function _rustCall<T>(cmd: string, args: Record<string, unknown>): Promise<T | null> {
	// Try server first
	const serverResult = await sendToServer<T>(cmd, args);
	if (serverResult !== null) return serverResult;
	// Fall back to CLI
	return cliCall<T>(cmd, args);
}

// ── Task State ──────────────────────────────────────────────
import * as tsTaskState from "./task-state.ts";

export function loadTaskState(cwd: string): tsTaskState.TaskState | undefined {
	const r = cliCall<any>("task_state_load", { path: tsTaskState.taskStatePath(cwd) });
	if (r && r.version === 1) return r as tsTaskState.TaskState;
	return tsTaskState.loadTaskState(cwd);
}

export function saveTaskState(cwd: string, state: tsTaskState.TaskState): void {
	const ok = cliCall<boolean>("task_state_save", { path: tsTaskState.taskStatePath(cwd), state });
	if (ok) return;
	tsTaskState.saveTaskState(cwd, state);
}

export function formatTaskState(state: tsTaskState.TaskState | undefined): string {
	const r = cliCall<string>("task_state_format", { state });
	if (r) return r;
	return tsTaskState.formatTaskState(state);
}

export function compactTaskState(state: tsTaskState.TaskState | undefined): string {
	const r = cliCall<string>("task_state_compact", { state });
	if (r) return r;
	return tsTaskState.compactTaskState(state);
}

// ── Event Ledger ────────────────────────────────────────────
import * as tsEventLedger from "./event-ledger.ts";

export function appendEvent(filePath: string, event: tsEventLedger.AgentEvent): void {
	const ok = cliCall<boolean>("event_append", { path: filePath, event });
	if (ok) return;
	tsEventLedger.appendEvent(filePath, event);
}

export function readEvents(filePath: string): tsEventLedger.AgentEvent[] {
	const r = cliCall<tsEventLedger.AgentEvent[]>("event_read", { path: filePath });
	if (r) return r;
	return tsEventLedger.readEvents(filePath);
}

// ── Context Checkpoint ──────────────────────────────────────
import * as tsCheckpoint from "./context-checkpoint.ts";

export function loadCheckpoint(cwd: string): tsCheckpoint.ContextCheckpoint | undefined {
	const r = cliCall<tsCheckpoint.ContextCheckpoint>("checkpoint_load", { path: tsCheckpoint.checkpointPath(cwd) });
	if (r) return r;
	return tsCheckpoint.loadCheckpoint(cwd);
}

export function saveCheckpoint(cwd: string, checkpoint: tsCheckpoint.ContextCheckpoint): void {
	const ok = cliCall<boolean>("checkpoint_save", { path: tsCheckpoint.checkpointPath(cwd), checkpoint });
	if (ok) return;
	tsCheckpoint.saveCheckpoint(cwd, checkpoint);
}

export function formatCheckpoint(checkpoint: tsCheckpoint.ContextCheckpoint): string {
	const r = cliCall<string>("checkpoint_format", { checkpoint });
	if (r) return r;
	return tsCheckpoint.formatCheckpoint(checkpoint);
}

export function compactCheckpoint(checkpoint: tsCheckpoint.ContextCheckpoint): string {
	const r = cliCall<string>("checkpoint_compact", { checkpoint });
	if (r) return r;
	return tsCheckpoint.compactCheckpoint(checkpoint);
}

// ── Bash Summarizer ─────────────────────────────────────────
export function summarizeLargeOutput(lines: string[]): string {
	const r = cliCall<string>("bash_summarize", { lines });
	if (r) return r;
	// TS fallback
	const errorRe = /(?:error|fail|exception|abort|fatal|undefinedvariable)/i;
	const warnRe = /(?:warn|deprecated|notice)/i;
	const errors = lines.filter((l) => errorRe.test(l)).slice(-10);
	const warnings = lines.filter((l) => warnRe.test(l)).slice(-5);
	const parts: string[] = [];
	if (errors.length > 0) {
		parts.push(`Errors (${errors.length}):`);
		for (const e of errors) parts.push(`  ${e.trim().slice(0, 200)}`);
	}
	if (warnings.length > 0) {
		parts.push(`Warnings (${warnings.length}):`);
		for (const w of warnings) parts.push(`  ${w.trim().slice(0, 200)}`);
	}
	if (parts.length === 0) {
		const head = lines
			.slice(0, 5)
			.map((l) => l.trim())
			.filter(Boolean);
		const tail = lines
			.slice(-5)
			.map((l) => l.trim())
			.filter(Boolean);
		const unique = [...new Set([...head, ...tail])];
		return unique.length > 0 ? unique.join("\n") : "(large output, no key lines found)";
	}
	return parts.join("\n");
}

// ── Prompt Builder ──────────────────────────────────────────
export function buildSummarizationPrompt(
	conversationText: string,
	previousSummary: string | undefined,
	customInstructions: string | undefined,
): string {
	const r = cliCall<{ prompt: string }>("build_summarization_prompt", {
		conversation_text: conversationText,
		previous_summary: previousSummary,
		custom_instructions: customInstructions,
	});
	if (r?.prompt) return r.prompt;
	const basePrompt = previousSummary ? "Update the JSON summary..." : "Create a structured context checkpoint...";
	return `<conversation>\n${conversationText}\n</conversation>\n\n${basePrompt}`;
}

export function parseJsonFromText(text: string): string | null {
	const r = cliCall<{ json: string }>("parse_json_from_text", { text });
	if (r?.json) return r.json;
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) return null;
	try {
		const parsed = JSON.parse(match[0]) as Record<string, unknown>;
		if (parsed.goal !== undefined) return match[0];
	} catch {
		/* fall through */
	}
	return null;
}

export { findBinary };

// Re-export event ledger helpers
export {
	compactionEvent,
	eventFilePath,
	taskCompleteEvent,
	taskStartEvent,
	taskStepEvent,
	toolCallEvent,
	toolResultEvent,
} from "./event-ledger.ts";
