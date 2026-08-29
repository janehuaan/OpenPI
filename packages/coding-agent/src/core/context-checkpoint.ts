/**
 * Structured context checkpoint for compaction.
 *
 * Instead of dumping a natural-language summary into the system prompt,
 * we persist a machine-readable checkpoint that the agent can read on restart
 * and immediately continue work without re-discovering state.
 *
 * File: `<cwd>/.pi/context-checkpoint.json`
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ContextCheckpoint {
	version: 1;
	createdAt: string;
	updatedAt: string;
	sessionId?: string;

	/** High-level goal the agent is working toward. */
	goal: string;

	/** What has been accomplished so far. */
	done: string[];

	/** What is currently being worked on. */
	inProgress: string[];

	/** What comes next, in order. */
	nextSteps: string[];

	/** Key decisions made and their rationale. */
	decisions: Array<{ what: string; why: string; context?: string }>;

	/** Known errors / blockers, with recovery status. */
	issues: Array<{ message: string; recovered: boolean; tool?: string; note?: string }>;

	/** Important file paths, function names, error messages to preserve. */
	criticalContext: string[];

	/** User requirements / constraints discovered during the session. */
	constraints: string[];

	/** Compressed conversation history (last N turns summarized). */
	historySummary?: string;

	/** Token budget remaining estimate. */
	estimatedTokensRemaining?: number;
}

export function checkpointPath(cwd: string): string {
	return join(cwd, ".pi", "context-checkpoint.json");
}

export function loadCheckpoint(cwd: string): ContextCheckpoint | undefined {
	const file = checkpointPath(cwd);
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
	const file = checkpointPath(cwd);
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, JSON.stringify(checkpoint, null, "\t"));
}

/** Format checkpoint as a short injection string for the system prompt. */
export function formatCheckpoint(checkpoint: ContextCheckpoint): string {
	const lines: string[] = [];
	lines.push(`## Session Context`);
	lines.push(`Goal: ${checkpoint.goal}`);
	if (checkpoint.done.length > 0) {
		lines.push(`Done:`);
		for (const d of checkpoint.done) lines.push(`  ✓ ${d}`);
	}
	if (checkpoint.inProgress.length > 0) {
		lines.push(`In progress:`);
		for (const ip of checkpoint.inProgress) lines.push(`  ● ${ip}`);
	}
	if (checkpoint.nextSteps.length > 0) {
		lines.push(`Next:`);
		for (const ns of checkpoint.nextSteps.slice(0, 5)) lines.push(`  → ${ns}`);
	}
	if (checkpoint.decisions.length > 0) {
		lines.push(`Decisions:`);
		for (const dec of checkpoint.decisions.slice(0, 3)) {
			lines.push(`  · ${dec.what}: ${dec.why}`);
		}
	}
	if (checkpoint.issues.some((i) => !i.recovered)) {
		lines.push(`Open issues:`);
		for (const issue of checkpoint.issues) {
			if (issue.recovered) continue;
			lines.push(`  ! ${issue.message}${issue.tool ? ` [${issue.tool}]` : ""}`);
		}
	}
	if (checkpoint.criticalContext.length > 0) {
		lines.push(`Critical context:`);
		for (const ctx of checkpoint.criticalContext.slice(0, 5)) lines.push(`  \` ${ctx}`);
	}
	if (checkpoint.constraints.length > 0) {
		lines.push(`Constraints:`);
		for (const c of checkpoint.constraints) lines.push(`  • ${c}`);
	}
	return lines.join("\n");
}

/**
 * Summarized injection: a shorter version for when token budget is tight.
 */
export function compactCheckpoint(checkpoint: ContextCheckpoint): string {
	const lines: string[] = [`Goal: ${checkpoint.goal}`];
	if (checkpoint.inProgress.length > 0) {
		lines.push(`Current: ${checkpoint.inProgress[0]}`);
	}
	if (checkpoint.nextSteps.length > 0) {
		lines.push(`Next: ${checkpoint.nextSteps[0]}`);
	}
	const openIssues = checkpoint.issues.filter((i) => !i.recovered);
	if (openIssues.length > 0) {
		lines.push(`Blockers: ${openIssues.map((i) => i.message).join("; ")}`);
	}
	return lines.join("\n");
}
