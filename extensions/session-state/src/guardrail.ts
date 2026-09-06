/**
 * Execution Resilience Guardrail: Thrashing & Dead-Loop Breaker
 *
 * Prevents LLMs from falling into repetitive failure loops (e.g. attempting the same
 * failing command or regex edit 3+ times consecutively without changing strategy).
 */

import { createHash } from "node:crypto";

export interface GuardrailOptions {
	/** Maximum consecutive failures for the exact same tool signature before blocking. Default: 3 */
	maxConsecutiveFailures?: number;
}

export interface GuardrailCheckResult {
	block: boolean;
	reason?: string;
	consecutiveFailures: number;
}

interface FailureRecord {
	count: number;
	lastError?: string;
	lastAttemptAt: number;
}

/**
 * Normalizes tool arguments to generate a stable, deterministic fingerprint.
 */
export function normalizeToolInput(toolName: string, input: unknown): string {
	if (!input || typeof input !== "object") return String(input ?? "");

	const obj = input as Record<string, unknown>;

	if (toolName === "bash" || toolName === "user_bash") {
		const cmd = typeof obj.command === "string" ? obj.command : typeof obj.cmd === "string" ? obj.cmd : "";
		return `cmd:${cmd.trim().replace(/\s+/g, " ")}`;
	}

	if (toolName === "edit") {
		const path = String(obj.path ?? obj.file ?? "");
		const target = String(obj.targetContent ?? obj.old_string ?? obj.search ?? "");
		return `edit:${path}:${target.trim()}`;
	}

	if (toolName === "read") {
		const path = String(obj.path ?? obj.file ?? "");
		return `read:${path.trim()}`;
	}

	if (toolName === "write") {
		const path = String(obj.path ?? obj.file ?? "");
		return `write:${path.trim()}`;
	}

	if (toolName === "subagent") {
		const agent = String(obj.agent ?? "");
		const task = String(obj.task ?? obj.prompt ?? "");
		return `subagent:${agent}:${task.trim().replace(/\s+/g, " ").slice(0, 100)}`;
	}

	// General object: deterministic JSON stringification with sorted keys
	try {
		const sortedEntries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b));
		return JSON.stringify(sortedEntries);
	} catch {
		return String(input);
	}
}

/**
 * Computes a deterministic 16-character hex signature for a tool call.
 */
export function computeToolSignature(toolName: string, input: unknown): string {
	const normalized = normalizeToolInput(toolName, input);
	const digest = createHash("sha256").update(`${toolName}:${normalized}`).digest("hex").slice(0, 16);
	return `${toolName}:${digest}`;
}

export class ThrashingGuardrail {
	private readonly failureRecords = new Map<string, FailureRecord>();
	private readonly maxConsecutiveFailures: number;

	constructor(options?: GuardrailOptions) {
		this.maxConsecutiveFailures = options?.maxConsecutiveFailures ?? 3;
	}

	/**
	 * Pre-execution check before a tool is executed.
	 * Returns block: true if the tool call signature has already failed consecutively >= threshold.
	 */
	checkToolCall(toolName: string, input: unknown): GuardrailCheckResult {
		const signature = computeToolSignature(toolName, input);
		const record = this.failureRecords.get(signature);

		if (record && record.count >= this.maxConsecutiveFailures) {
			const errorSnippet = record.lastError ? `\nRecent error context: ${record.lastError.slice(0, 200)}` : "";
			return {
				block: true,
				consecutiveFailures: record.count,
				reason: `[Runtime Guardrail]: Identical action (${toolName}) attempted ${record.count} times with recurring failures. Execution halted to prevent token thrashing.${errorSnippet}\nGuidance: Stop and re-evaluate your approach. Do not repeat the same arguments or commands; inspect the codebase or try an alternative method.`,
			};
		}

		return {
			block: false,
			consecutiveFailures: record?.count ?? 0,
		};
	}

	/**
	 * Post-execution update to register whether the tool succeeded or failed.
	 */
	recordToolResult(toolName: string, input: unknown, isError: boolean, errorText?: string): void {
		const signature = computeToolSignature(toolName, input);

		if (!isError) {
			// Success: reset failure counter for this signature
			this.failureRecords.delete(signature);
			return;
		}

		const existing = this.failureRecords.get(signature);
		const count = (existing?.count ?? 0) + 1;
		this.failureRecords.set(signature, {
			count,
			lastError: errorText,
			lastAttemptAt: Date.now(),
		});
	}

	/**
	 * Resets all tracked failures (e.g. at session start or turn reset).
	 */
	reset(): void {
		this.failureRecords.clear();
	}
}
