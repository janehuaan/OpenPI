#!/usr/bin/env node
/**
 * Adapter: fetch recent email text via OPENPI_EMAIL_CLI or himalaya/mail fallbacks.
 * Prints plain text for agent summarization. Never sends mail.
 */
import { spawn } from "node:child_process";

function printHelp(): void {
	console.log(`openpi email-fetch

Usage:
  email-fetch [--limit N]

Environment:
  OPENPI_EMAIL_CLI   Preferred command (argv string, shell-run via sh -c)
  Fallback tries: himalaya envelope list

Examples:
  OPENPI_EMAIL_CLI='himalaya envelope list' node email-fetch.ts
  OPENPI_EMAIL_CLI='notmuch search --output=summary tag:inbox' node email-fetch.ts --limit 20
`);
}

function run(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.once("error", reject);
		child.once("close", (code) => {
			resolve({
				code: code ?? 1,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
	});
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		printHelp();
		return;
	}
	const limitIndex = args.indexOf("--limit");
	const limit = limitIndex >= 0 ? Number(args[limitIndex + 1] ?? 20) : 20;
	const configured = process.env.OPENPI_EMAIL_CLI?.trim();
	const candidates = configured
		? [{ label: "OPENPI_EMAIL_CLI", command: "sh", argv: ["-c", configured] }]
		: [
				{ label: "himalaya", command: "himalaya", argv: ["envelope", "list"] },
				{ label: "notmuch", command: "notmuch", argv: ["search", "--output=summary", "tag:inbox"] },
			];

	for (const candidate of candidates) {
		try {
			const result = await run(candidate.command, candidate.argv);
			if (result.code === 0 && result.stdout.trim()) {
				const lines = result.stdout.trim().split("\n");
				const clipped = lines.slice(0, Number.isFinite(limit) ? limit : 20).join("\n");
				console.log(`# email source: ${candidate.label}\n${clipped}`);
				return;
			}
		} catch {
			// try next
		}
	}
	console.error(
		"No email CLI available. Set OPENPI_EMAIL_CLI to a command that prints recent messages, e.g. himalaya envelope list",
	);
	process.exit(1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
