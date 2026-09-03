/**
 * Structured task state.
 *
 * A goal, ordered steps with evidence, checkpoints, and errors, persisted so a
 * session that was compacted or restarted knows exactly where it left off.
 *
 * File: `<cwd>/.pi/tasks/<sessionId>.json`.
 *
 * Scoping by session id is deliberate. The old implementation wrote one shared
 * `current.json` per directory and then had to filter by session id at read
 * time; every new conversation in that directory still had to load and reject
 * another session's abandoned list. Putting the id in the filename means a
 * session only ever sees its own file.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type TaskStatus = "idle" | "running" | "paused" | "completed" | "failed";
export type StepStatus = "pending" | "in_progress" | "completed" | "blocked";
export type EvidenceKind = "verification" | "review" | "diff" | "files" | "manual";

export interface TaskEvidence {
	kind: EvidenceKind;
	summary: string;
	command?: string;
	paths?: string[];
}

export interface TaskStep {
	content: string;
	status: StepStatus;
	/** Present-tense form shown while the step runs ("Running tests"). */
	activeForm?: string;
	result?: string;
	evidence?: TaskEvidence[];
	error?: string;
}

export interface TaskCheckpoint {
	index: number;
	label: string;
	done: boolean;
	result?: string;
	error?: string;
}

export interface TaskError {
	message: string;
	tool?: string;
	recovered: boolean;
	createdAt: string;
}

export interface TaskState {
	version: 1;
	sessionId: string;
	goal: string;
	status: TaskStatus;
	steps: TaskStep[];
	checkpoints: TaskCheckpoint[];
	errors: TaskError[];
	nextSteps: string[];
	contextNotes: string[];
	createdAt: string;
	updatedAt: string;
}

export function tasksDir(cwd: string): string {
	return join(cwd, ".pi", "tasks");
}

export function taskStatePath(cwd: string, sessionId: string): string {
	return join(tasksDir(cwd), `${sessionId}.json`);
}

export function emptyTaskState(sessionId: string, goal = ""): TaskState {
	const now = new Date().toISOString();
	return {
		version: 1,
		sessionId,
		goal,
		status: "idle",
		steps: [],
		checkpoints: [],
		errors: [],
		nextSteps: [],
		contextNotes: [],
		createdAt: now,
		updatedAt: now,
	};
}

export function loadTaskState(cwd: string, sessionId: string): TaskState | undefined {
	const file = taskStatePath(cwd, sessionId);
	if (!existsSync(file)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as TaskState;
		if (parsed.version !== 1 || !Array.isArray(parsed.steps)) return undefined;
		return parsed;
	} catch {
		// A corrupt file must not stop the session; the agent rebuilds its list.
		return undefined;
	}
}

export function saveTaskState(cwd: string, state: TaskState): void {
	const file = taskStatePath(cwd, state.sessionId);
	mkdirSync(dirname(file), { recursive: true });
	const next: TaskState = { ...state, updatedAt: new Date().toISOString() };
	// Write-then-rename: a crash mid-write would otherwise truncate the state.
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(next, null, "\t")}\n`, "utf8");
	renameSync(temporary, file);
}

export function deleteTaskState(cwd: string, sessionId: string): void {
	const file = taskStatePath(cwd, sessionId);
	if (existsSync(file)) unlinkSync(file);
}

/** Session ids that have task state in this directory. */
export function listTaskStateSessions(cwd: string): string[] {
	const dir = tasksDir(cwd);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json"))
		.map((name) => name.slice(0, -".json".length));
}

export function hasOpenWork(state: TaskState | undefined): boolean {
	if (!state) return false;
	return state.steps.some((step) => step.status !== "completed") || state.nextSteps.length > 0;
}

/** Full human-readable rendering, for a UI panel or the task tool's output. */
export function formatTaskState(state: TaskState | undefined): string {
	if (!state || (state.steps.length === 0 && !state.goal)) return "(no active task)";

	const lines: string[] = [`Goal: ${state.goal || "(unset)"}`, `Status: ${state.status}`];

	if (state.steps.length > 0) {
		lines.push("", "Steps:");
		for (const step of state.steps) {
			lines.push(`  ${stepIcon(step.status)} [${step.status}] ${step.content}`);
			if (step.error) lines.push(`    error: ${step.error}`);
			if (step.result) lines.push(`    result: ${step.result}`);
			for (const evidence of step.evidence ?? []) {
				const command = evidence.command ? ` (${evidence.command})` : "";
				lines.push(`    evidence[${evidence.kind}]: ${evidence.summary}${command}`);
			}
		}
	}

	if (state.checkpoints.length > 0) {
		lines.push("", "Checkpoints:");
		for (const checkpoint of state.checkpoints) {
			lines.push(`  ${checkpoint.done ? "done" : "open"} ${checkpoint.label}`);
		}
	}

	const openErrors = state.errors.filter((error) => !error.recovered);
	if (openErrors.length > 0) {
		lines.push("", "Unresolved errors:");
		for (const error of openErrors.slice(-5)) {
			lines.push(`  ${error.message.slice(0, 200)}${error.tool ? ` [${error.tool}]` : ""}`);
		}
	}

	if (state.nextSteps.length > 0) {
		lines.push("", "Next:");
		for (const next of state.nextSteps.slice(0, 8)) lines.push(`  - ${next}`);
	}

	if (state.contextNotes.length > 0) {
		lines.push("", "Context:");
		for (const note of state.contextNotes.slice(0, 8)) lines.push(`  - ${note}`);
	}

	return lines.join("\n");
}

/**
 * Short rendering for per-turn context injection. Kept deliberately terse and
 * deterministic: the injected text is compared against the previous turn's to
 * decide whether to re-inject, so unstable output would defeat prompt caching.
 */
export function compactTaskState(state: TaskState | undefined): string {
	if (!state || state.steps.length === 0) return "";

	const incomplete = state.steps.filter((step) => step.status !== "completed");
	if (incomplete.length === 0) return `Task complete: ${state.goal}`;

	const lines: string[] = [`Goal: ${state.goal}`];
	const current = incomplete.find((step) => step.status === "in_progress");
	if (current) {
		lines.push(`Current: ${current.content}${current.error ? ` (error: ${current.error})` : ""}`);
	}

	const pending = incomplete.filter((step) => step.status !== "in_progress");
	if (pending.length > 0 && pending.length <= 3) {
		lines.push(`Remaining: ${pending.map((step) => step.content).join("; ")}`);
	} else if (pending.length > 3) {
		lines.push(`Remaining: ${pending.length} steps`);
	}

	const blocked = incomplete.filter((step) => step.status === "blocked");
	if (blocked.length > 0) lines.push(`Blocked: ${blocked.map((step) => step.content).join("; ")}`);

	const openErrors = state.errors.filter((error) => !error.recovered).length;
	if (openErrors > 0) lines.push(`Unresolved errors: ${openErrors}`);

	return lines.join("\n");
}

function stepIcon(status: StepStatus): string {
	if (status === "completed") return "x";
	if (status === "in_progress") return ">";
	if (status === "blocked") return "!";
	return "-";
}
