import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getSocketPath } from "../../orchestrator/src/config.ts";
import { sendIpcRequest } from "../../orchestrator/src/ipc/client.ts";
import { encodeMessage, type OrchestratorResponse, parseResponseLine } from "../../orchestrator/src/ipc/protocol.ts";

export interface ChatSessionMap {
	version: 1;
	byChatId: Record<string, { instanceId: string; cwd: string; updatedAt: string }>;
}

export interface PendingUiRequest {
	id: string;
	method: string;
	title: string;
	message?: string;
	options?: string[];
	createdAt: string;
}

export type UiResponder = (request: PendingUiRequest) => Promise<{
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}>;

function sessionsPath(): string {
	const base = process.env.OPENPI_CHAT_STATE_DIR ?? join(homedir(), ".pi", "openpi-chat");
	return join(base, "sessions.json");
}

export function loadSessionMap(): ChatSessionMap {
	const file = sessionsPath();
	if (!existsSync(file)) return { version: 1, byChatId: {} };
	try {
		const value = JSON.parse(readFileSync(file, "utf8")) as ChatSessionMap;
		if (value?.version === 1 && value.byChatId && typeof value.byChatId === "object") return value;
	} catch {
		// reset
	}
	return { version: 1, byChatId: {} };
}

export function saveSessionMap(map: ChatSessionMap): void {
	const file = sessionsPath();
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

function resolveOrchestratorCli(): string {
	if (process.env.PI_ORCHESTRATOR_CLI && existsSync(process.env.PI_ORCHESTRATOR_CLI)) {
		return resolve(process.env.PI_ORCHESTRATOR_CLI);
	}
	const candidates = [
		resolve(process.cwd(), "packages/orchestrator/dist/cli.js"),
		resolve(process.cwd(), "node_modules/@earendil-works/pi-orchestrator/dist/cli.js"),
	];
	const found = candidates.find(existsSync);
	if (!found) throw new Error("Orchestrator CLI not found. Build packages/orchestrator or set PI_ORCHESTRATOR_CLI.");
	return found;
}

async function ensureDaemon(): Promise<void> {
	const socket = getSocketPath();
	if (existsSync(socket)) {
		try {
			await sendIpcRequest({ type: "health" });
			return;
		} catch {
			// restart
		}
	}
	const cli = resolveOrchestratorCli();
	const child = spawn(process.execPath, [cli, "serve"], {
		detached: true,
		stdio: "ignore",
		env: process.env,
	});
	child.unref();
	for (let attempt = 0; attempt < 40; attempt++) {
		await delay(100);
		try {
			await sendIpcRequest({ type: "health" });
			return;
		} catch {
			// wait
		}
	}
	throw new Error("Orchestrator daemon did not become ready.");
}

function assertOk(response: OrchestratorResponse, label: string): OrchestratorResponse {
	if (!response.ok) {
		throw new Error(`${label}: ${"error" in response ? response.error : "unknown error"}`);
	}
	return response;
}

export async function ensureChatInstance(options: { chatId: string; cwd: string; label?: string }): Promise<string> {
	await ensureDaemon();
	const map = loadSessionMap();
	const existing = map.byChatId[options.chatId];
	if (existing) {
		const status = await sendIpcRequest({ type: "status", instanceId: existing.instanceId });
		if (status.ok && status.type === "status_result" && status.instance) {
			return existing.instanceId;
		}
	}
	const spawned = assertOk(
		await sendIpcRequest({
			type: "spawn",
			cwd: options.cwd,
			label: options.label ?? `telegram:${options.chatId}`,
		}),
		"spawn",
	);
	if (spawned.type !== "spawn_result" || !spawned.instance) {
		throw new Error("spawn did not return an instance");
	}
	map.byChatId[options.chatId] = {
		instanceId: spawned.instance.id,
		cwd: options.cwd,
		updatedAt: new Date().toISOString(),
	};
	saveSessionMap(map);
	return spawned.instance.id;
}

function extractTextFromRpc(response: OrchestratorResponse): string | undefined {
	if (response.type !== "rpc_result" || !response.response) return undefined;
	const payload = response.response as { success?: boolean; data?: unknown };
	if (!payload.success || !payload.data || typeof payload.data !== "object") return undefined;
	const data = payload.data as Record<string, unknown>;
	if (typeof data.text === "string") return data.text;
	return undefined;
}

/**
 * Prompt with optional extension UI bridge over rpc_stream.
 * Falls back to simple rpc + poll when no uiResponder is provided.
 */
export async function promptInstance(options: {
	instanceId: string;
	message: string;
	timeoutMs?: number;
	uiResponder?: UiResponder;
	onPartialText?: (delta: string) => void;
}): Promise<string> {
	await ensureDaemon();
	if (!options.uiResponder && !options.onPartialText) {
		return promptInstanceSimple(options);
	}
	return promptInstanceStreaming(options);
}

async function promptInstanceSimple(options: {
	instanceId: string;
	message: string;
	timeoutMs?: number;
}): Promise<string> {
	assertOk(
		await sendIpcRequest({
			type: "rpc",
			instanceId: options.instanceId,
			command: { type: "prompt", message: options.message },
		}),
		"prompt",
	);
	const timeoutMs = options.timeoutMs ?? 180_000;
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const stateResponse = assertOk(
			await sendIpcRequest({
				type: "rpc",
				instanceId: options.instanceId,
				command: { type: "get_state" },
			}),
			"get_state",
		);
		if (stateResponse.type === "rpc_result") {
			const data = (stateResponse.response as { data?: { isStreaming?: boolean } })?.data;
			if (data && data.isStreaming === false) break;
		}
		await delay(300);
	}
	const textResponse = assertOk(
		await sendIpcRequest({
			type: "rpc",
			instanceId: options.instanceId,
			command: { type: "get_last_assistant_text" },
		}),
		"get_last_assistant_text",
	);
	const text = extractTextFromRpc(textResponse);
	return text?.trim() || "(empty assistant response)";
}

async function promptInstanceStreaming(options: {
	instanceId: string;
	message: string;
	timeoutMs?: number;
	uiResponder?: UiResponder;
	onPartialText?: (delta: string) => void;
}): Promise<string> {
	const timeoutMs = options.timeoutMs ?? 180_000;
	const socketPath = getSocketPath();
	return new Promise<string>((resolve, reject) => {
		const socket = createConnection(socketPath);
		let buffer = "";
		let settled = false;
		let lastText = "";
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			socket.end();
			void promptInstanceSimple(options).then(resolve).catch(reject);
		}, timeoutMs);

		const finish = (text: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.end();
			resolve(text || "(empty assistant response)");
		};

		socket.on("connect", () => {
			socket.write(encodeMessage({ type: "rpc_stream", instanceId: options.instanceId }));
			socket.write(encodeMessage({ type: "prompt", message: options.message }));
		});

		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();
			while (true) {
				const newline = buffer.indexOf("\n");
				if (newline === -1) break;
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (!line) continue;
				let message: Record<string, unknown>;
				try {
					message = JSON.parse(line) as Record<string, unknown>;
				} catch {
					continue;
				}
				if (message.type === "extension_ui_request" && typeof message.id === "string") {
					const request: PendingUiRequest = {
						id: message.id,
						method: String(message.method ?? "confirm"),
						title: String(message.title ?? "Confirmation"),
						message: typeof message.message === "string" ? message.message : undefined,
						options: Array.isArray(message.options)
							? message.options.filter((entry): entry is string => typeof entry === "string")
							: undefined,
						createdAt: new Date().toISOString(),
					};
					const responder =
						options.uiResponder ??
						(async () => {
							// Safe default for unattended: cancel UI prompts
							return { cancelled: true };
						});
					void responder(request).then((answer) => {
						const cancelled = "cancelled" in answer && answer.cancelled === true;
						socket.write(
							encodeMessage({
								type: "extension_ui_response",
								id: request.id,
								value: cancelled ? undefined : "value" in answer ? answer.value : undefined,
								confirmed: cancelled ? undefined : "confirmed" in answer ? answer.confirmed : undefined,
								cancelled,
							} as never),
						);
					});
					continue;
				}
				if (message.type === "message_update" || message.type === "agent_end") {
					// Best-effort partial extraction
					const assistant = message.message as { role?: string; content?: unknown } | undefined;
					if (assistant?.role === "assistant" && Array.isArray(assistant.content)) {
						const text = assistant.content
							.map((part) =>
								part && typeof part === "object" && "text" in part
									? String((part as { text?: string }).text ?? "")
									: "",
							)
							.join("");
						if (text && text !== lastText) {
							const delta = text.slice(lastText.length);
							lastText = text;
							if (delta) options.onPartialText?.(delta);
						}
					}
				}
				if (message.type === "agent_end" || (message.type === "rpc_result" && message.command === "prompt")) {
					// continue until idle via follow-up poll
				}
			}
		});

		socket.on("error", (error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(error);
		});

		// When stream stays open, poll for idle then finish with last assistant text
		void (async () => {
			try {
				const started = Date.now();
				while (Date.now() - started < timeoutMs) {
					await delay(400);
					const stateResponse = await sendIpcRequest({
						type: "rpc",
						instanceId: options.instanceId,
						command: { type: "get_state" },
					});
					if (stateResponse.ok && stateResponse.type === "rpc_result") {
						const data = (stateResponse.response as { data?: { isStreaming?: boolean } })?.data;
						if (data && data.isStreaming === false) {
							const textResponse = await sendIpcRequest({
								type: "rpc",
								instanceId: options.instanceId,
								command: { type: "get_last_assistant_text" },
							});
							const text = extractTextFromRpc(textResponse) || lastText;
							finish(text.trim());
							return;
						}
					}
				}
				finish(lastText);
			} catch (error) {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					reject(error);
				}
			}
		})();
	});
}

// re-export for tests that import parseResponseLine
export { parseResponseLine };
