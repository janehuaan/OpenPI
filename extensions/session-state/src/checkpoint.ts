/**
 * Structured context checkpoint.
 *
 * After compaction the natural-language summary is good for a human but poor
 * for resuming work. This is the machine-readable half: goal, done, in
 * progress, next steps, decisions, open issues, critical context, constraints.
 * It survives a restart, so a resumed session continues instead of
 * re-discovering state.
 *
 * File: `<cwd>/.pi/checkpoints/<sessionId>.json`, scoped per session for the
 * same reason as task state.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface CheckpointDecision {
	what: string;
	why: string;
}

export interface CheckpointIssue {
	message: string;
	recovered: boolean;
	tool?: string;
}

export interface ContextCheckpoint {
	version: 1;
	sessionId: string;
	createdAt: string;
	updatedAt: string;
	goal: string;
	done: string[];
	inProgress: string[];
	nextSteps: string[];
	decisions: CheckpointDecision[];
	issues: CheckpointIssue[];
	/** File paths, symbol names, error strings worth preserving verbatim. */
	criticalContext: string[];
	/** Requirements and constraints the user stated during the session. */
	constraints: string[];
	/** The full summary text this checkpoint was parsed from, truncated. */
	historySummary?: string;
	tokensBefore?: number;
}

/** The JSON shape the summarization model is asked to produce. */
export interface CheckpointDraft {
	goal?: unknown;
	done?: unknown;
	inProgress?: unknown;
	nextSteps?: unknown;
	decisions?: unknown;
	issues?: unknown;
	criticalContext?: unknown;
	constraints?: unknown;
}

export function checkpointsDir(cwd: string): string {
	return join(cwd, ".pi", "checkpoints");
}

export function checkpointPath(cwd: string, sessionId: string): string {
	return join(checkpointsDir(cwd), `${sessionId}.json`);
}

export function loadCheckpoint(cwd: string, sessionId: string): ContextCheckpoint | undefined {
	const file = checkpointPath(cwd, sessionId);
	if (!existsSync(file)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as ContextCheckpoint;
		if (parsed.version !== 1) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

export function saveCheckpoint(cwd: string, checkpoint: ContextCheckpoint): void {
	const file = checkpointPath(cwd, checkpoint.sessionId);
	mkdirSync(dirname(file), { recursive: true });
	const next: ContextCheckpoint = { ...checkpoint, updatedAt: new Date().toISOString() };
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
	renameSync(temporary, file);
}

export function deleteCheckpoint(cwd: string, sessionId: string): void {
	const file = checkpointPath(cwd, sessionId);
	if (existsSync(file)) unlinkSync(file);
}

const stringList = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];

/**
 * Extract a checkpoint from a summary that should contain JSON.
 *
 * Models wrap JSON in prose or fences even when told not to, so this finds the
 * outermost balanced object rather than trusting the whole string to parse.
 * Returns undefined when nothing usable is found; callers keep the plain
 * summary in that case rather than losing the compaction.
 */
export function parseCheckpointDraft(summary: string): CheckpointDraft | undefined {
	const start = summary.indexOf("{");
	if (start < 0) return undefined;

	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < summary.length; index++) {
		const char = summary[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (char === "{") depth++;
		else if (char === "}") {
			depth--;
			if (depth === 0) {
				try {
					const parsed = JSON.parse(summary.slice(start, index + 1)) as unknown;
					if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
					return parsed as CheckpointDraft;
				} catch {
					return undefined;
				}
			}
		}
	}
	return undefined;
}

/** Normalize a model-produced draft into a checkpoint, dropping malformed items. */
export function checkpointFromDraft(
	sessionId: string,
	draft: CheckpointDraft,
	options: { summary?: string; tokensBefore?: number; previous?: ContextCheckpoint } = {},
): ContextCheckpoint {
	const now = new Date().toISOString();
	const decisions = Array.isArray(draft.decisions)
		? draft.decisions
				.filter((item): item is { what?: unknown; why?: unknown } => Boolean(item) && typeof item === "object")
				.map((item) => ({
					what: typeof item.what === "string" ? item.what : "",
					why: typeof item.why === "string" ? item.why : "",
				}))
				.filter((decision) => decision.what.length > 0)
		: [];

	const issues = Array.isArray(draft.issues)
		? draft.issues
				.filter((item): item is { message?: unknown; recovered?: unknown; tool?: unknown } =>
					Boolean(item) && typeof item === "object",
				)
				.map((item) => ({
					message: typeof item.message === "string" ? item.message : "",
					recovered: item.recovered === true,
					tool: typeof item.tool === "string" ? item.tool : undefined,
				}))
				.filter((issue) => issue.message.length > 0)
		: [];

	return {
		version: 1,
		sessionId,
		createdAt: options.previous?.createdAt ?? now,
		updatedAt: now,
		goal: typeof draft.goal === "string" ? draft.goal : (options.previous?.goal ?? ""),
		done: stringList(draft.done),
		inProgress: stringList(draft.inProgress),
		nextSteps: stringList(draft.nextSteps),
		decisions,
		issues,
		criticalContext: stringList(draft.criticalContext),
		constraints: stringList(draft.constraints),
		historySummary: options.summary ? options.summary.slice(0, 4000) : options.previous?.historySummary,
		tokensBefore: options.tokensBefore ?? options.previous?.tokensBefore,
	};
}

/** Full rendering, for a UI panel. */
export function formatCheckpoint(checkpoint: ContextCheckpoint): string {
	const lines: string[] = ["## Session context", `Goal: ${checkpoint.goal || "(unset)"}`];
	const section = (title: string, items: string[], limit = 8) => {
		if (items.length === 0) return;
		lines.push(`${title}:`);
		for (const item of items.slice(0, limit)) lines.push(`  - ${item}`);
	};

	section("Done", checkpoint.done, 12);
	section("In progress", checkpoint.inProgress);
	section("Next", checkpoint.nextSteps);
	if (checkpoint.decisions.length > 0) {
		lines.push("Decisions:");
		for (const decision of checkpoint.decisions.slice(0, 6)) {
			lines.push(`  - ${decision.what}: ${decision.why}`);
		}
	}
	const open = checkpoint.issues.filter((issue) => !issue.recovered);
	if (open.length > 0) {
		lines.push("Open issues:");
		for (const issue of open) lines.push(`  - ${issue.message}${issue.tool ? ` [${issue.tool}]` : ""}`);
	}
	section("Critical context", checkpoint.criticalContext);
	section("Constraints", checkpoint.constraints);
	return lines.join("\n");
}

/** Short rendering for per-turn injection. Same stability requirement as task state. */
export function compactCheckpoint(checkpoint: ContextCheckpoint | undefined): string {
	if (!checkpoint) return "";
	const lines: string[] = [];
	if (checkpoint.goal) lines.push(`Goal: ${checkpoint.goal}`);
	if (checkpoint.inProgress.length > 0) lines.push(`Current: ${checkpoint.inProgress.slice(0, 2).join("; ")}`);
	if (checkpoint.nextSteps.length > 0) lines.push(`Next: ${checkpoint.nextSteps[0]}`);
	const open = checkpoint.issues.filter((issue) => !issue.recovered);
	if (open.length > 0) lines.push(`Blockers: ${open.map((issue) => issue.message).join("; ")}`);
	if (checkpoint.constraints.length > 0) {
		lines.push(`Constraints: ${checkpoint.constraints.slice(0, 3).join("; ")}`);
	}
	return lines.join("\n");
}
