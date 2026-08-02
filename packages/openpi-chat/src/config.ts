export interface ChatBridgeConfig {
	telegramBotToken: string;
	allowChatIds: number[];
	cwd: string;
	piCliPath?: string;
	label: string;
}

export function loadChatConfig(env: NodeJS.ProcessEnv = process.env): ChatBridgeConfig {
	const token = env.OPENPI_TELEGRAM_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN;
	if (!token) throw new Error("Set OPENPI_TELEGRAM_BOT_TOKEN (or TELEGRAM_BOT_TOKEN).");
	const allow = (env.OPENPI_TELEGRAM_ALLOW_CHAT_IDS ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean)
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value));
	return {
		telegramBotToken: token,
		allowChatIds: allow,
		cwd: env.OPENPI_CHAT_CWD ?? process.cwd(),
		piCliPath: env.PI_CLI_PATH,
		label: env.OPENPI_CHAT_LABEL ?? "telegram",
	};
}
