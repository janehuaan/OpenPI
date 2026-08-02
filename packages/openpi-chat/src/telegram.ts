import { runPrintPrompt, runRpcPrompt } from "./bridge.ts";
import type { ChatBridgeConfig } from "./config.ts";
import type { PendingUiRequest, UiResponder } from "./rpc-session.ts";

interface TelegramUpdate {
	update_id: number;
	message?: {
		message_id: number;
		text?: string;
		chat: { id: number; type: string };
		from?: { id: number; username?: string };
	};
}

interface TelegramResponse<T> {
	ok: boolean;
	result: T;
	description?: string;
}

const pendingUiByChat = new Map<
	number,
	{
		request: PendingUiRequest;
		resolve: (value: { value?: string; confirmed?: boolean; cancelled?: boolean }) => void;
	}
>();

async function api<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
	const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	const payload = (await response.json()) as TelegramResponse<T>;
	if (!payload.ok) throw new Error(payload.description ?? `Telegram API failed: ${method}`);
	return payload.result;
}

function makeUiResponder(token: string, chatId: number): UiResponder {
	return async (request) => {
		const lines = [
			`[OpenPI approval] ${request.title}`,
			request.message ?? "",
			request.options?.length ? `Options: ${request.options.join(" | ")}` : "Reply yes / no",
			"Reply within 5 minutes.",
		].filter(Boolean);
		await api(token, "sendMessage", { chat_id: chatId, text: lines.join("\n") });
		return await new Promise((resolve) => {
			const timer = setTimeout(() => {
				pendingUiByChat.delete(chatId);
				resolve({ cancelled: true });
			}, 5 * 60_000);
			pendingUiByChat.set(chatId, {
				request,
				resolve: (value) => {
					clearTimeout(timer);
					pendingUiByChat.delete(chatId);
					resolve(value);
				},
			});
		});
	};
}

export async function runTelegramBridge(config: ChatBridgeConfig): Promise<void> {
	let offset = 0;
	const preferRpc = process.env.OPENPI_CHAT_MODE !== "print";
	console.log(
		`openpi-chat telegram bridge started (cwd=${config.cwd}, mode=${preferRpc ? "rpc-multiturn+ui" : "print"})`,
	);
	if (config.allowChatIds.length === 0) {
		console.warn("Warning: OPENPI_TELEGRAM_ALLOW_CHAT_IDS is empty; all chats are rejected until configured.");
	}
	for (;;) {
		const updates = await api<TelegramUpdate[]>(config.telegramBotToken, "getUpdates", {
			offset,
			timeout: 30,
			allowed_updates: ["message"],
		});
		for (const update of updates) {
			offset = update.update_id + 1;
			const message = update.message;
			if (!message?.text) continue;
			const chatId = message.chat.id;
			if (config.allowChatIds.length > 0 && !config.allowChatIds.includes(chatId)) {
				await api(config.telegramBotToken, "sendMessage", {
					chat_id: chatId,
					text: "Unauthorized chat id for this OpenPI bridge.",
				});
				continue;
			}
			const text = message.text.trim();
			if (!text) continue;

			// Resolve pending extension UI first
			const pending = pendingUiByChat.get(chatId);
			if (pending) {
				const lower = text.toLowerCase();
				if (pending.request.method === "confirm") {
					if (["yes", "y", "ok", "allow", "是", "确认"].includes(lower)) {
						pending.resolve({ confirmed: true });
					} else if (["no", "n", "deny", "cancel", "否", "取消"].includes(lower)) {
						pending.resolve({ cancelled: true, confirmed: false });
					} else {
						pending.resolve({ cancelled: true });
					}
					await api(config.telegramBotToken, "sendMessage", {
						chat_id: chatId,
						text: "Approval response recorded.",
					});
					continue;
				}
				if (pending.request.method === "select" && pending.request.options?.length) {
					const match = pending.request.options.find(
						(option) => option.toLowerCase() === lower || option === text,
					);
					if (match) pending.resolve({ value: match });
					else pending.resolve({ cancelled: true });
					await api(config.telegramBotToken, "sendMessage", {
						chat_id: chatId,
						text: match ? `Selected: ${match}` : "Selection cancelled.",
					});
					continue;
				}
				pending.resolve({ value: text });
				continue;
			}

			await api(config.telegramBotToken, "sendChatAction", { chat_id: chatId, action: "typing" });
			try {
				let result = preferRpc
					? await runRpcPrompt({
							prompt: text,
							cwd: config.cwd,
							chatId: String(chatId),
							label: config.label,
							uiResponder: makeUiResponder(config.telegramBotToken, chatId),
							onPartialText: async () => {
								// Lightweight keepalive typing indicator
								try {
									await api(config.telegramBotToken, "sendChatAction", {
										chat_id: chatId,
										action: "typing",
									});
								} catch {
									// ignore
								}
							},
						})
					: await runPrintPrompt({
							prompt: text,
							cwd: config.cwd,
							piCliPath: config.piCliPath,
						});
				if (preferRpc && result.exitCode !== 0) {
					console.warn(`RPC path failed (${result.stderr}); falling back to print mode.`);
					result = await runPrintPrompt({
						prompt: text,
						cwd: config.cwd,
						piCliPath: config.piCliPath,
					});
				}
				const reply =
					result.exitCode === 0
						? result.stdout || "(empty response)"
						: `Error (exit ${result.exitCode}): ${result.stderr || result.stdout || "unknown"}`;
				for (const chunk of chunkText(reply, 3500)) {
					await api(config.telegramBotToken, "sendMessage", { chat_id: chatId, text: chunk });
				}
			} catch (error) {
				await api(config.telegramBotToken, "sendMessage", {
					chat_id: chatId,
					text: error instanceof Error ? error.message : String(error),
				});
			}
		}
	}
}

function chunkText(text: string, size: number): string[] {
	if (text.length <= size) return [text];
	const chunks: string[] = [];
	for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
	return chunks;
}
