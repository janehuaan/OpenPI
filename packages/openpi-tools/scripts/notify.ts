#!/usr/bin/env node
/**
 * Adapter: desktop notification via OPENPI_NOTIFY_CLI or platform fallbacks.
 */
import { spawn } from "node:child_process";

function printHelp(): void {
	console.log(`openpi notify

Usage:
  notify --title <title> --body <body>

Environment:
  OPENPI_NOTIFY_CLI   Preferred command template; supports {title} and {body}
  Fallbacks: osascript (macOS), notify-send (Linux), powershell (Windows)

Examples:
  OPENPI_NOTIFY_CLI='terminal-notifier -title "{title}" -message "{body}"' node notify.ts --title Hi --body There
`);
}

function run(command: string, args: string[]): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: "ignore", env: process.env });
		child.once("error", reject);
		child.once("close", (code) => resolve(code ?? 1));
	});
}

function getFlag(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		printHelp();
		return;
	}
	const title = getFlag(args, "--title") ?? "OpenPI";
	const body = getFlag(args, "--body") ?? "";
	if (!body) {
		console.error("--body is required");
		process.exit(1);
	}
	const configured = process.env.OPENPI_NOTIFY_CLI?.trim();
	if (configured) {
		const cmd = configured.replaceAll("{title}", title.replaceAll("'", "\\'")).replaceAll("{body}", body.replaceAll("'", "\\'"));
		const code = await run("sh", ["-c", cmd]);
		process.exit(code);
	}
	if (process.platform === "darwin") {
		const script = `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`;
		const code = await run("osascript", ["-e", script]);
		process.exit(code);
	}
	if (process.platform === "linux") {
		const code = await run("notify-send", [title, body]);
		process.exit(code);
	}
	if (process.platform === "win32") {
		const ps = `New-BurntToastNotification -Text ${JSON.stringify(title)}, ${JSON.stringify(body)}`;
		const code = await run("powershell", ["-NoProfile", "-Command", ps]);
		process.exit(code === 0 ? 0 : 1);
	}
	console.error("No notifier available. Set OPENPI_NOTIFY_CLI.");
	process.exit(1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
