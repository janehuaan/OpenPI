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
	| { id: string; type: "subscribe"; sessionId: string }
	| { id: string; type: "unsubscribe"; sessionId: string }
	/** Forwarded verbatim to the session's pi subprocess. */
	| { id: string; type: "rpc"; sessionId: string; command: PiRpcCommand }
	/** App-level operations that never reach a session (models, auth, packages). */
	| { id: string; type: "app"; op: AppOp };

export type AppOp =
	| { name: "list_models" }
	| { name: "auth_status" }
	| { name: "import_global_credentials" };

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
 * Split a byte chunk into complete JSON lines, returning the parsed values and
 * whatever partial trailing text should be carried into the next call.
 */
export function decodeLines(buffer: string, chunk: string): { messages: unknown[]; rest: string } {
	const combined = buffer + chunk;
	const parts = combined.split("\n");
	const rest = parts.pop() ?? "";
	const messages: unknown[] = [];
	for (const part of parts) {
		const line = part.trim();
		if (!line) continue;
		messages.push(JSON.parse(line));
	}
	return { messages, rest };
}
