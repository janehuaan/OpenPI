#!/usr/bin/env node
/**
 * Adapter: list today's calendar events via OPENPI_CALENDAR_CLI or common fallbacks.
 */
import { spawn } from "node:child_process";

function printHelp(): void {
	console.log(`openpi calendar-today

Usage:
  calendar-today

Environment:
  OPENPI_CALENDAR_CLI   Preferred command (sh -c)
  Fallbacks: icalBuddy eventsToday, gcalcli agenda

Examples:
  OPENPI_CALENDAR_CLI='icalBuddy eventsToday' node calendar-today.ts
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
	const configured = process.env.OPENPI_CALENDAR_CLI?.trim();
	const candidates = configured
		? [{ label: "OPENPI_CALENDAR_CLI", command: "sh", argv: ["-c", configured] }]
		: [
				{ label: "icalBuddy", command: "icalBuddy", argv: ["eventsToday"] },
				{ label: "gcalcli", command: "gcalcli", argv: ["agenda"] },
			];
	for (const candidate of candidates) {
		try {
			const result = await run(candidate.command, candidate.argv);
			if (result.code === 0 && result.stdout.trim()) {
				console.log(`# calendar source: ${candidate.label}\n${result.stdout.trim()}`);
				return;
			}
		} catch {
			// try next
		}
	}
	console.error(
		"No calendar CLI available. Set OPENPI_CALENDAR_CLI, e.g. icalBuddy eventsToday or gcalcli agenda",
	);
	process.exit(1);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
