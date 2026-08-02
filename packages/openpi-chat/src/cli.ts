#!/usr/bin/env node
import { loadChatConfig } from "./config.ts";
import { runDiscordBridge } from "./discord.ts";
import { runTelegramBridge } from "./telegram.ts";

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		console.log(`openpi-chat

Usage:
  openpi-chat telegram
  openpi-chat discord

Environment (telegram):
  OPENPI_TELEGRAM_BOT_TOKEN
  OPENPI_TELEGRAM_ALLOW_CHAT_IDS
  OPENPI_CHAT_CWD
  PI_CLI_PATH / PI_ORCHESTRATOR_CLI
  OPENPI_CHAT_MODE=print|rpc

Environment (discord):
  OPENPI_DISCORD_BOT_TOKEN
  OPENPI_DISCORD_ALLOW_CHANNEL_IDS
  OPENPI_DISCORD_ALLOW_GUILD_IDS
  OPENPI_CHAT_CWD
`);
		return;
	}
	const surface = args[0] ?? "telegram";
	if (surface === "telegram") {
		const config = loadChatConfig();
		await runTelegramBridge(config);
		return;
	}
	if (surface === "discord") {
		const token = process.env.OPENPI_DISCORD_BOT_TOKEN;
		if (!token) throw new Error("Set OPENPI_DISCORD_BOT_TOKEN");
		const allowChannelIds = (process.env.OPENPI_DISCORD_ALLOW_CHANNEL_IDS ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		const allowGuildIds = (process.env.OPENPI_DISCORD_ALLOW_GUILD_IDS ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean);
		await runDiscordBridge({
			token,
			cwd: process.env.OPENPI_CHAT_CWD ?? process.cwd(),
			allowChannelIds: allowChannelIds.length ? allowChannelIds : undefined,
			allowGuildIds: allowGuildIds.length ? allowGuildIds : undefined,
		});
		return;
	}
	throw new Error(`Unknown surface: ${surface}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
