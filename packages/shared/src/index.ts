/**
 * Wire protocol between the desktop app and the openpi daemon.
 *
 * One long-lived connection carries everything, multiplexed by request id.
 * The old OpenPI ran two parallel schemes - a short-connection request/response
 * path plus a separate long-lived `rpc_stream` socket that bypassed its own
 * client wrapper. That split is why connection management lived in two places
 * and drifted. Here: one connection, requests correlated by `id`, events pushed
 * with no id.
 *
 * Framing is newline-delimited JSON. Session-level commands are forwarded
 * verbatim to a `pi --mode rpc` subprocess, so they follow upstream's RPC
 * protocol (see coding-agent docs/rpc.md) and are typed as opaque here.
 */

/** Opaque upstream RPC command, forwarded to `pi --mode rpc` unchanged. */
export type PiRpcCommand = { type: string; [key: string]: unknown };

/** Opaque upstream RPC/agent event emitted by a `pi --mode rpc` subprocess. */
export type PiRpcEvent = { type: string; [key: string]: unknown };

export type SessionMode = "chat" | "code";

export interface SessionInfo {
	sessionId: string;
	cwd: string;
	mode: SessionMode;
	name?: string;
	model?: string;
	/** Live subprocess present, vs. known-but-suspended. */
	running: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface HealthInfo {
	ok: true;
	pid: number;
	version: string;
	/** mtime of the resolved pi CLI entry, for version-drift detection. */
	cliMtimeMs: number;
	cliPath: string;
	sessionCount: number;
	runningCount: number;
	uptimeMs: number;
}

/** Requests: desktop -> daemon. Every one carries an `id`. */
export type ClientRequest =
	| { id: string; type: "health" }
	| { id: string; type: "shutdown" }
	| { id: string; type: "list_sessions" }
	| { id: string; type: "create_session"; cwd: string; mode?: SessionMode; model?: string; name?: string }
	| { id: string; type: "stop_session"; sessionId: string }
	| { id: string; type: "delete_session"; sessionId: string }
	| { id: string; type: "rename_session"; sessionId: string; name: string }
	| { id: string; type: "subscribe"; sessionId: string }
	| { id: string; type: "unsubscribe"; sessionId: string }
	/** Forwarded verbatim to the session's pi subprocess. */
	| { id: string; type: "rpc"; sessionId: string; command: PiRpcCommand }
	/** App-level operations that never reach a session (models, auth, packages). */
	| { id: string; type: "app"; op: AppOp };

/**
 * App-level operations: not tied to a session, handled by the daemon directly.
 *
 * These are what the old fork needed 8 of its 12 custom pi RPC commands for.
 * They never belonged in the session protocol - a model catalog or a provider
 * login has nothing to do with a conversation.
 */
export type AppOp =
	| { name: "list_models" }
	| { name: "auth_status" }
	| { name: "import_global_credentials" }
	| { name: "default_workspace" }
	| { name: "recent_workspaces" }
	| { name: "workspace_summary"; cwd: string }
	| { name: "list_memory"; cwd: string; scope?: MemoryScope }
	| { name: "read_memory_topic"; cwd: string; scope?: MemoryScope; type: string; key: string }
	| { name: "write_memory"; cwd: string; scope?: MemoryScope; type: string; key: string; value: string; body?: string }
	| { name: "delete_memory"; cwd: string; scope?: MemoryScope; type: string; key: string }
	// Scheduled tasks. The scheduler is its own package but needs a long-lived
	// process to tick in, so the daemon hosts it and forwards these.
	| { name: "list_tasks" }
	| { name: "create_task"; input: CreateTaskInput }
	| { name: "set_task_paused"; taskId: string; paused: boolean }
	| { name: "delete_task"; taskId: string }
	| { name: "run_task"; taskId: string }
	| { name: "cancel_run"; runId: string }
	| { name: "step_runs"; runId: string }
	| { name: "read_run_log"; runId: string; stream: "stdout" | "stderr" }
	// Profile and capabilities.
	| { name: "get_profile" }
	| { name: "save_profile"; profile: UserProfile }
	| { name: "capabilities" }
	| { name: "add_extension"; path: string }
	| { name: "remove_extension"; path: string }
	| { name: "install_package"; source: string }
	| { name: "remove_package"; source: string }
	/** Extract text from an attached document, for prompt inclusion. */
	| { name: "extract_document"; fileName: string; dataBase64: string };

export interface UserProfile {
	nickname?: string;
	/** A single emoji, used as the avatar. */
	avatarEmoji?: string;
	updatedAt?: string;
}

export interface CapabilityEntry {
	/** Path or package source as written in settings. */
	source: string;
	/** Resolved absolute path, when it is a local file. */
	resolved?: string;
	kind: "extension" | "package" | "skill" | "prompt";
	/** False when the path no longer exists on disk. */
	present: boolean;
}

export interface Capabilities {
	agentDir: string;
	entries: CapabilityEntry[];
}

export interface DocumentText {
	name: string;
	text: string;
	/** True when the text was cut to fit a prompt. */
	truncated: boolean;
}

/**
 * Task shapes, mirrored from @openpi/scheduler.
 *
 * Duplicated rather than imported so the renderer - which must not depend on a
 * Node package - still gets types. The daemon validates against the real ones.
 */
export type TaskSchedule =
	| { kind: "once"; runAt: string }
	| { kind: "cron"; expression: string; timezone?: string };

export interface TaskStepInput {
	id: string;
	title: string;
	prompt: string;
	dependsOn?: string[];
	tools?: string[];
}

export interface CreateTaskInput {
	title: string;
	prompt: string;
	cwd?: string;
	schedule: TaskSchedule;
	model?: string;
	tools?: string[];
	steps?: TaskStepInput[];
	maxConcurrentSteps?: number;
	retry?: { maxAttempts: number; backoffMs?: number };
}

export type TaskStatus = "active" | "paused";
export type TaskRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

export interface TaskSummary {
	id: string;
	title: string;
	prompt: string;
	cwd?: string;
	schedule: TaskSchedule;
	status: TaskStatus;
	nextRunAt?: string;
	createdAt: string;
	updatedAt: string;
	model?: string;
	steps?: TaskStepInput[];
}

export interface TaskRunSummary {
	id: string;
	taskId: string;
	status: TaskRunStatus;
	trigger: "manual" | "scheduled" | "retry";
	createdAt: string;
	startedAt?: string;
	finishedAt?: string;
	exitCode?: number;
	result?: string;
	error?: string;
	attempt?: number;
}

export interface TaskWithRuns {
	task: TaskSummary;
	runs: TaskRunSummary[];
}

export type MemoryScope = "project" | "global";

export interface MemoryEntry {
	type: string;
	key: string;
	value: string;
}

export interface WorkspaceSummary {
	cwd: string;
	exists: boolean;
	isGitRepo: boolean;
	branch?: string;
	fileCount: number;
	hasMemory: boolean;
	memoryCount: number;
}

export interface ProviderStatus {
	provider: string;
	configured: boolean;
	baseUrl?: string;
	modelCount: number;
}

export interface ModelOption {
	provider: string;
	modelId: string;
	/** `provider/modelId`, the form the CLI's --model flag needs. */
	ref: string;
}

/** Responses and pushed events: daemon -> desktop. */
export type ServerMessage =
	| { id: string; type: "response"; ok: true; data: unknown }
	| { id: string; type: "response"; ok: false; error: string }
	/** Pushed to every subscriber of `sessionId`; carries no request id. */
	| { type: "event"; sessionId: string; event: PiRpcEvent };

/**
 * A request minus its `id`, for callers that let the client generate one.
 *
 * Must distribute over the union: a plain `Omit<ClientRequest, "id">` collapses
 * to the properties common to every member, which drops `cwd`, `sessionId`, etc.
 */
export type ClientRequestInput = ClientRequest extends infer T
	? T extends { id: string }
		? Omit<T, "id">
		: never
	: never;

export function encodeMessage(message: ClientRequest | ServerMessage): string {
	return `${JSON.stringify(message)}\n`;
}

/**
 * Split a byte chunk into complete JSON lines.
 *
 * A line that does not parse is reported in `errors` and skipped, rather than
 * throwing: the framing is line-delimited, so one bad line must cost only that
 * line. Throwing here would take down every valid frame that arrived in the same
 * chunk, and the callers' only recovery is to drop the whole buffer.
 *
 * `rest` is the trailing partial line to carry into the next call.
 */
export function decodeLines(
	buffer: string,
	chunk: string,
): { messages: unknown[]; rest: string; errors: string[] } {
	const combined = buffer + chunk;
	const parts = combined.split("\n");
	const rest = parts.pop() ?? "";
	const messages: unknown[] = [];
	const errors: string[] = [];
	for (const part of parts) {
		const line = part.trim();
		if (!line) continue;
		try {
			messages.push(JSON.parse(line));
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}
	return { messages, rest, errors };
}
