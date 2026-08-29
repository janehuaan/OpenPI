/**
 * Structured task state for long-running agents.
 *
 * Extends the simple todo list with goal, checkpoints, errors, and next steps
 * so that after compaction or restart the agent knows exactly where it left off.
 *
 * State lives in `<cwd>/.pi/tasks/current.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TaskStatus = "idle" | "running" | "paused" | "completed" | "failed";
export type StepStatus = "pending" | "in_progress" | "completed" | "blocked";
export type EvidenceKind = "verification" | "review" | "diff" | "files" | "manual";

export interface TaskCheckpoint {
	index: number;
	label: string;
	done: boolean;
	result?: string;
	error?: string;
}

export interface TaskError {
	message: string;
	stack?: string;
	tool?: string;
	recovered: boolean;
	createdAt: string;
}

export interface TaskStep {
	content: string;
	status: StepStatus;
	activeForm?: string;
	result?: string;
	evidence?: { kind: EvidenceKind; summary: string; command?: string; paths?: string[] }[];
	error?: string;
}

export interface TaskState {
	version: 1;
	id: string;
	goal: string;
	status: TaskStatus;
	steps: TaskStep[];
	checkpoints: TaskCheckpoint[];
	errors: TaskError[];
	nextSteps: string[];
	contextNotes: string[];
	updatedAt: string;
	sessionId?: string;
}

export function taskStatePath(cwd: string): string {
	return join(cwd, ".pi", "tasks", "current.json");
}

export function loadTaskState(cwd: string): TaskState | undefined {
	const file = taskStatePath(cwd);
	if (!existsSync(file)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as TaskState;
		if (parsed.version !== 1) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

export function saveTaskState(cwd: string, state: TaskState): void {
	const file = taskStatePath(cwd);
	mkdirSync(join(file, ".."), { recursive: true });
	writeFileSync(file, JSON.stringify(state, null, "\t"));
}

export function formatTaskState(state: TaskState | undefined): string {
	if (!state || state.steps.length === 0) return "(no active task)";
	const lines: string[] = [];
	lines.push(`Goal: ${state.goal}`);
	lines.push(`Status: ${state.status}`);
	lines.push("");
	lines.push("Steps:");
	for (let i = 0; i < state.steps.length; i++) {
		const step = state.steps[i];
		const icon =
			step.status === "completed"
				? "✓"
				: step.status === "in_progress"
					? "●"
					: step.status === "blocked"
						? "!"
						: "○";
		lines.push(`  ${icon} [${step.status}] ${step.content}`);
		if (step.error) lines.push(`    Error: ${step.error}`);
		if (step.result) lines.push(`    Result: ${step.result}`);
	}
	if (state.checkpoints.length > 0) {
		lines.push("");
		lines.push("Checkpoints:");
		for (const cp of state.checkpoints) {
			lines.push(`  ${cp.done ? "✓" : "○"} ${cp.label}`);
		}
	}
	if (state.errors.length > 0) {
		lines.push("");
		lines.push("Errors:");
		for (const err of state.errors.slice(-3)) {
			lines.push(`  ${err.recovered ? "↩" : "✗"} ${err.message.slice(0, 100)}`);
		}
	}
	if (state.nextSteps.length > 0) {
		lines.push("");
		lines.push("Next:");
		for (const ns of state.nextSteps.slice(0, 5)) {
			lines.push(`  - ${ns}`);
		}
	}
	if (state.contextNotes.length > 0) {
		lines.push("");
		lines.push("Context:");
		for (const note of state.contextNotes.slice(0, 5)) {
			lines.push(`  · ${note}`);
		}
	}
	return lines.join("\n");
}

/** Compact task state into a short injection string for the system prompt. */
export function compactTaskState(state: TaskState | undefined): string {
	if (!state || state.steps.length === 0) return "";
	const incomplete = state.steps.filter((s) => s.status !== "completed");
	if (incomplete.length === 0) {
		return `Task completed: ${state.goal}`;
	}
	const inProgress = incomplete.find((s) => s.status === "in_progress");
	const pending = incomplete.filter((s) => s.status !== "in_progress");
	const lines: string[] = [`Goal: ${state.goal}`];
	if (inProgress) {
		lines.push(`Current: ${inProgress.content}${inProgress.error ? ` (error: ${inProgress.error})` : ""}`);
	}
	if (pending.length > 0 && pending.length <= 3) {
		lines.push(`Remaining: ${pending.map((s) => s.content).join(", ")}`);
	} else if (pending.length > 3) {
		lines.push(`Remaining: ${pending.length} steps (see task state for details)`);
	}
	if (state.errors.filter((e) => !e.recovered).length > 0) {
		lines.push(`Unresolved errors: ${state.errors.filter((e) => !e.recovered).length}`);
	}
	return lines.join("\n");
}
