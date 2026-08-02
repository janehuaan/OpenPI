/** @deprecated Import from ./discord.ts instead. */

export type { DiscordBridgeConfig } from "./discord.ts";
export { runDiscordBridge } from "./discord.ts";

import { runRpcPrompt } from "./bridge.ts";
import type { DiscordBridgeConfig } from "./discord.ts";

/** One-shot helper for custom Discord bots that already own the gateway. */
export async function handleDiscordMessage(options: {
	config: DiscordBridgeConfig;
	channelId: string;
	userId: string;
	content: string;
}): Promise<string> {
	const chatId = `discord:${options.channelId}:${options.userId}`;
	const result = await runRpcPrompt({
		prompt: options.content,
		cwd: options.config.cwd,
		chatId,
		label: `discord:${options.channelId}`,
	});
	if (result.exitCode !== 0) throw new Error(result.stderr || "Discord RPC prompt failed");
	return result.stdout;
}
