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

// ── Bash Summarizer ─────────────────────────────────────────
export function summarizeLargeOutput(lines: string[]): string {
	const r = cliCall({ cmd: "bash_summarize", lines });
	if (r?.ok && typeof r.data === "object" && typeof (r.data as any).summary === "string") {
		return (r.data as { summary: string }).summary;
	}
	// Fallback to TS implementation
	return summarizeLargeOutputTs(lines);
}

function summarizeLargeOutputTs(lines: string[]): string {
	const errorRe = /(?:error|fail|exception|abort|fatal|undefinedvariable)/i;
	const warnRe = /(?:warn|deprecated|notice)/i;
	const summaryRe = /^[,\s]*[✓✔✗✘×]/;
	const bulletRe = /^\s*[-*] /;
	const errors = lines.filter((l) => errorRe.test(l)).slice(-10);
	const warnings = lines.filter((l) => warnRe.test(l)).slice(-5);
	const summaryLines = lines.filter((l) => summaryRe.test(l) || bulletRe.test(l)).slice(-10);
	const parts: string[] = [];
	if (errors.length > 0) {
		parts.push(`Errors (${errors.length}):`);
		for (const e of errors) parts.push(`  ${e.trim().slice(0, 200)}`);
	}
	if (warnings.length > 0) {
		parts.push(`Warnings (${warnings.length}):`);
		for (const w of warnings) parts.push(`  ${w.trim().slice(0, 200)}`);
	}
	if (summaryLines.length > 0 && errors.length === 0 && warnings.length === 0) {
		parts.push("Key lines:");
		for (const s of summaryLines) parts.push(`  ${s.trim().slice(0, 200)}`);
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

// ── Compaction Prompt Builder ───────────────────────────────
export function buildSummarizationPrompt(
	conversationText: string,
	previousSummary: string | undefined,
	customInstructions: string | undefined,
): string {
	const r = cliCall({
		cmd: "build_summarization_prompt",
		conversation_text: conversationText,
		previous_summary: previousSummary,
		custom_instructions: customInstructions,
	});
	if (r?.ok && typeof r.data === "object" && typeof (r.data as any).prompt === "string") {
		return (r.data as { prompt: string }).prompt;
	}
	// Fallback: build prompt in TS
	return buildSummarizationPromptTs(conversationText, previousSummary, customInstructions);
}

function buildSummarizationPromptTs(
	conversationText: string,
	previousSummary: string | undefined,
	customInstructions: string | undefined,
): string {
	const basePrompt = previousSummary
		? `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.\n\nUpdate the JSON summary with new information. RULES:\n- PRESERVE all existing fields from the previous summary\n- ADD new progress, decisions, and context from the new messages\n- UPDATE "done": move items from "inProgress" to "done" when completed\n- UPDATE "nextSteps" based on what was accomplished\n- UPDATE "issues": mark recovered=true when an issue is resolved\n- PRESERVE exact file paths, function names, and error messages\n- If something is no longer relevant, remove it from that field\n\nOutput ONLY the updated JSON, no markdown fences, no explanation.`
		: `The messages above are a conversation to summarize. Create a structured context checkpoint in JSON format that another LLM will use to continue the work.\n\nOutput ONLY valid JSON, no markdown fences, no explanation. Use this EXACT structure:\n{\n  "goal": "What is the user trying to accomplish?",\n  "done": ["Completed tasks/changes"],\n  "inProgress": ["Current work"],\n  "nextSteps": ["Ordered list of what should happen next"],\n  "decisions": [{"what": "Decision made", "why": "Rationale"}],\n  "issues": [{"message": "Error or blocker", "recovered": false, "tool": "tool-name"}],\n  "criticalContext": ["File paths, function names, error messages to preserve"],\n  "constraints": ["User requirements and constraints"]\n}\n\nRules:\n- Preserve exact file paths, function names, and error messages\n- Keep each field concise but complete\n- "done" should include all completed items\n- "inProgress" should have at most 1-2 items (the current focus)\n- "issues" only includes unresolved problems (recovered=false)\n- If a section has nothing, use empty array [] not null`;
	let promptText = `<conversation>\n${conversationText}\n</conversation>\n\n`;
	if (previousSummary) {
		promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
	}
	promptText += basePrompt;
	if (customInstructions) {
		promptText += `\n\nAdditional focus: ${customInstructions}`;
	}
	return promptText;
}

export function parseJsonFromText(text: string): string | null {
	const r = cliCall({ cmd: "parse_json_from_text", text });
	if (r?.ok && typeof r.data === "object" && (r.data as any)?.json) {
		return (r.data as { json: string }).json;
	}
	// Fallback
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
