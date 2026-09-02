/**
 * One `pi --mode rpc` subprocess per session.
 *
 * Frames are newline-delimited JSON on stdin/stdout. Three kinds of line come
 * back, distinguished exactly as the Phase 0 spike observed them:
 *   - `{type:"response", id, success, data}`  -> resolves a pending request
 *   - `{type:"extension_ui_request", id, ...}` -> needs a reply on stdin
 *   - anything else                            -> a session event, broadcast
 *
 * Broadcast is one-to-many on purpose: several windows can watch one session.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { decodeLines, type PiRpcCommand, type PiRpcEvent, type SessionMode } from "@openpi/shared";
import { agentDir, piRpcEntry } from "./config.ts";

/** Tool profile for code sessions. Chat sessions get the built-in default set. */
const CODE_MODE_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export interface RpcProcessOptions {
	sessionId: string;
	cwd: string;
	mode: SessionMode;
	model?: string;
	sessionFile?: string;
	/** Extra CLI args, e.g. --append-system-prompt. */
	extraArgs?: string[];
}

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: NodeJS.Timeout;
};

export type EventListener = (event: PiRpcEvent) => void;
export type UiRequestHandler = (request: PiRpcEvent) => void;

export function buildRpcArgs(options: RpcProcessOptions): string[] {
	const args = ["--mode", "rpc"];
	// A bare --provider is ignored by the CLI; only --model <provider>/<id>
	// actually switches provider (verified in the Phase 0 spike).
	if (options.model) args.push("--model", options.model);
	if (options.sessionFile) args.push("--session", options.sessionFile);
	else args.push("--no-session");
	if (options.mode === "code") args.push("--tools", CODE_MODE_TOOLS.join(","));
	if (options.extraArgs?.length) args.push(...options.extraArgs);
	return args;
}

export class RpcProcess {
	readonly sessionId: string;
	private child: ChildProcess | undefined;
	private stdoutBuffer = "";
	private readonly pending = new Map<string, PendingRequest>();
	private readonly eventListeners = new Set<EventListener>();
	private readonly exitListeners = new Set<(code: number | null) => void>();
	private uiRequestHandler: UiRequestHandler | undefined;
	private exited = false;

	constructor(options: RpcProcessOptions) {
		this.sessionId = options.sessionId;
		const args = buildRpcArgs(options);
		this.child = spawn(process.execPath, [piRpcEntry(), ...args], {
			cwd: options.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				// Without this the subprocess loads the user's global extensions
				// and model defaults instead of openpi's own.
				PI_CODING_AGENT_DIR: agentDir(),
			},
		});

		this.child.stdout?.setEncoding("utf8");
		this.child.stdout?.on("data", (chunk: string) => this.handleChunk(chunk));
		this.child.stderr?.setEncoding("utf8");
		this.child.stderr?.on("data", (chunk: string) => {
			process.stderr.write(`[session ${this.sessionId}] ${chunk}`);
		});
		this.child.on("exit", (code) => this.handleExit(code));
		this.child.on("error", (error) => {
			process.stderr.write(`[session ${this.sessionId}] spawn error: ${error.message}\n`);
			this.handleExit(null);
		});
	}

	get running(): boolean {
		return !this.exited && this.child !== undefined;
	}

	onEvent(listener: EventListener): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	onExit(listener: (code: number | null) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	setUiRequestHandler(handler: UiRequestHandler | undefined): void {
		this.uiRequestHandler = handler;
	}

	/** Send a command and await its correlated response. */
	send(command: PiRpcCommand, timeoutMs = 120_000): Promise<unknown> {
		if (!this.running) return Promise.reject(new Error(`session ${this.sessionId} is not running`));
		const id = typeof command.id === "string" ? command.id : randomUUID();
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC ${String(command.type)} timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			this.write({ ...command, id });
		});
	}

	/** Fire-and-forget write, used for UI responses which carry no reply. */
	write(message: Record<string, unknown>): void {
		this.child?.stdin?.write(`${JSON.stringify(message)}\n`);
	}

	stop(): void {
		if (!this.child || this.exited) return;
		this.child.kill("SIGTERM");
		// SIGTERM first so the session can flush; escalate only if it hangs.
		const child = this.child;
		setTimeout(() => {
			if (!this.exited) child.kill("SIGKILL");
		}, 3000).unref();
	}

	private handleChunk(chunk: string): void {
		let messages: unknown[];
		try {
			const decoded = decodeLines(this.stdoutBuffer, chunk);
			messages = decoded.messages;
			this.stdoutBuffer = decoded.rest;
		} catch (error) {
			// A malformed line must not desync the stream for everything after it.
			process.stderr.write(`[session ${this.sessionId}] bad frame: ${String(error)}\n`);
			this.stdoutBuffer = "";
			return;
		}
		for (const message of messages) {
			this.dispatch(message as PiRpcEvent);
		}
	}

	private dispatch(message: PiRpcEvent): void {
		if (message.type === "response" && typeof message.id === "string") {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.success === false) {
				pending.reject(new Error(typeof message.error === "string" ? message.error : "RPC failed"));
			} else {
				pending.resolve(message.data ?? null);
			}
			return;
		}

		if (message.type === "extension_ui_request") {
			if (this.uiRequestHandler) this.uiRequestHandler(message);
			return;
		}

		for (const listener of this.eventListeners) {
			listener(message);
		}
	}

	private handleExit(code: number | null): void {
		if (this.exited) return;
		this.exited = true;
		this.child = undefined;
		for (const [, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(new Error(`session ${this.sessionId} exited (code ${String(code)})`));
		}
		this.pending.clear();
		for (const listener of this.exitListeners) listener(code);
	}
}
