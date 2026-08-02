/**
 * Minimal Discord gateway bridge (WebSocket + REST).
 * Requires OPENPI_DISCORD_BOT_TOKEN and Message Content intent enabled for the bot.
 */

import { runRpcPrompt } from "./bridge.ts";

export interface DiscordBridgeConfig {
	token: string;
	cwd: string;
	/** Only respond in these channel IDs when set. */
	allowChannelIds?: string[];
	/** Only respond in these guild IDs when set. */
	allowGuildIds?: string[];
	label?: string;
}

interface GatewayPayload {
	op: number;
	d?: unknown;
	s?: number | null;
	t?: string | null;
}

const API = "https://discord.com/api/v10";

async function rest<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			authorization: `Bot ${token}`,
			"content-type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Discord REST ${method} ${path}: ${response.status} ${text}`);
	}
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

export async function runDiscordBridge(config: DiscordBridgeConfig): Promise<void> {
	const gateway = await rest<{ url: string }>(config.token, "GET", "/gateway/bot");
	const url = `${gateway.url}/?v=10&encoding=json`;
	console.log(`openpi-chat discord bridge connecting (${config.cwd})`);

	let resumeSeq: number | null = null;
	let sessionId: string | undefined;
	let heartbeatInterval: NodeJS.Timeout | undefined;
	let reconnectDelay = 1_000;

	const connect = (): Promise<void> =>
		new Promise((_resolve, reject) => {
			const ws = new WebSocket(url);
			let identified = false;

			const send = (payload: GatewayPayload) => {
				ws.send(JSON.stringify(payload));
			};

			ws.addEventListener("open", () => {
				reconnectDelay = 1_000;
			});

			ws.addEventListener("message", (event) => {
				void (async () => {
					const raw = typeof event.data === "string" ? event.data : String(event.data);
					const payload = JSON.parse(raw) as GatewayPayload;
					if (typeof payload.s === "number") resumeSeq = payload.s;

					if (payload.op === 10) {
						const hello = payload.d as { heartbeat_interval: number };
						if (heartbeatInterval) clearInterval(heartbeatInterval);
						heartbeatInterval = setInterval(() => {
							send({ op: 1, d: resumeSeq });
						}, hello.heartbeat_interval);
						if (sessionId && resumeSeq !== null) {
							send({
								op: 6,
								d: { token: config.token, session_id: sessionId, seq: resumeSeq },
							});
						} else {
							send({
								op: 2,
								d: {
									token: config.token,
									intents: (1 << 0) | (1 << 9) | (1 << 15), // guilds + guild messages + message content
									properties: { os: process.platform, browser: "openpi-chat", device: "openpi-chat" },
								},
							});
						}
						return;
					}

					if (payload.op === 0 && payload.t === "READY") {
						identified = true;
						const data = payload.d as { session_id?: string };
						sessionId = data.session_id;
						console.log("openpi-chat discord READY");
						return;
					}

					if (payload.op === 0 && payload.t === "MESSAGE_CREATE") {
						const message = payload.d as {
							id: string;
							content?: string;
							author?: { id: string; bot?: boolean };
							channel_id: string;
							guild_id?: string;
						};
						if (!message.content || message.author?.bot) return;
						if (config.allowChannelIds?.length && !config.allowChannelIds.includes(message.channel_id)) return;
						if (
							config.allowGuildIds?.length &&
							message.guild_id &&
							!config.allowGuildIds.includes(message.guild_id)
						) {
							return;
						}
						const chatId = `discord:${message.channel_id}:${message.author?.id ?? "user"}`;
						try {
							await rest(config.token, "POST", `/channels/${message.channel_id}/typing`, {});
							const result = await runRpcPrompt({
								prompt: message.content,
								cwd: config.cwd,
								chatId,
								label: config.label ?? `discord:${message.channel_id}`,
							});
							const text =
								result.exitCode === 0
									? result.stdout || "(empty response)"
									: `Error: ${result.stderr || result.stdout || "unknown"}`;
							for (const chunk of chunkText(text, 1900)) {
								await rest(config.token, "POST", `/channels/${message.channel_id}/messages`, {
									content: chunk,
									message_reference: { message_id: message.id },
								});
							}
						} catch (error) {
							await rest(config.token, "POST", `/channels/${message.channel_id}/messages`, {
								content: error instanceof Error ? error.message : String(error),
							});
						}
					}

					if (payload.op === 7 || payload.op === 9) {
						// reconnect / invalid session
						ws.close();
					}
				})();
			});

			ws.addEventListener("close", () => {
				if (heartbeatInterval) clearInterval(heartbeatInterval);
				if (!identified) {
					reject(new Error("Discord gateway closed before READY"));
					return;
				}
				setTimeout(() => {
					reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
					void connect().catch((error) => {
						console.error(error);
					});
				}, reconnectDelay);
			});

			ws.addEventListener("error", (error) => {
				console.error("Discord gateway error", error);
			});
		});

	// Keep process alive on reconnect loop
	for (;;) {
		try {
			await connect();
		} catch (error) {
			console.error(error);
			await new Promise((resolve) => setTimeout(resolve, reconnectDelay));
			reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
		}
	}
}

function chunkText(text: string, size: number): string[] {
	if (text.length <= size) return [text];
	const chunks: string[] = [];
	for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
	return chunks;
}
