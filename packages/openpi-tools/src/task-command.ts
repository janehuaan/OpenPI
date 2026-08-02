/**
 * Interactive /task command with list picker + create wizard.
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function runPiTask(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [process.argv[1] ?? "pi", "task", ...args], {
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.once("error", reject);
		child.once("close", (code) => {
			resolve({
				code: code ?? 1,
				stdout: Buffer.concat(stdout).toString("utf8").trim(),
				stderr: Buffer.concat(stderr).toString("utf8").trim(),
			});
		});
	});
}

function parseTaskLines(listOutput: string): Array<{ id: string; label: string }> {
	const lines = listOutput
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.toLowerCase().startsWith("no tasks"));
	const tasks: Array<{ id: string; label: string }> = [];
	for (const line of lines) {
		// status id title next
		const match =
			line.match(/^(active|paused)\s+([0-9a-f-]{8,})\s+(.+?)\s{2,}(.+)$/i) ??
			line.match(/^(active|paused)\s+([0-9a-f-]{8,})\s+(.+)$/i);
		if (!match) continue;
		const id = match[2];
		const rest = match[3] ?? "";
		tasks.push({ id, label: `${match[1]} ${rest}`.slice(0, 80) });
	}
	return tasks;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("task", {
		description:
			"Orchestrator tasks: list|status|runs|run|pause|resume|show|create|pick  (UI pickers when available)",
		handler: async (args, ctx) => {
			const raw = args.trim();
			if (!raw || raw === "help") {
				ctx.ui.notify(
					[
						"/task list | status | runs [id]",
						"/task pick                 (select a task then run/pause/show)",
						"/task run|pause|resume|show <id>",
						"/task create               (interactive wizard when UI available)",
						"/task create <title> | <prompt>   (once in +1 min, security strict)",
					].join("\n"),
					"info",
				);
				return;
			}
			const parts = raw.split(/\s+/).filter(Boolean);
			const action = parts[0] ?? "list";

			if (action === "create") {
				const rest = raw.slice("create".length).trim();
				let titlePart = "";
				let promptPart = "";
				if (!rest && ctx.hasUI) {
					titlePart = (await ctx.ui.input("Task title", "Daily review"))?.trim() ?? "";
					promptPart = (await ctx.ui.input("Task prompt", "Review recent changes"))?.trim() ?? "";
					const schedule = await ctx.ui.select("Schedule", ["once (+1 min)", "cron daily 09:00 UTC"]);
					if (!titlePart || !promptPart) {
						ctx.ui.notify("Cancelled.", "warning");
						return;
					}
					const command =
						schedule === "cron daily 09:00 UTC"
							? [
									"create",
									"--title",
									titlePart,
									"--prompt",
									promptPart,
									"--cron",
									"0 9 * * *",
									"--cwd",
									ctx.cwd,
									"--security-mode",
									"strict",
								]
							: [
									"create",
									"--title",
									titlePart,
									"--prompt",
									promptPart,
									"--at",
									new Date(Date.now() + 60_000).toISOString(),
									"--cwd",
									ctx.cwd,
									"--security-mode",
									"strict",
								];
					const result = await runPiTask(command);
					ctx.ui.notify((result.stdout || result.stderr).slice(0, 2000), result.code === 0 ? "info" : "error");
					return;
				}
				const split = rest.split("|").map((part) => part.trim());
				titlePart = split[0] ?? "";
				promptPart = split[1] ?? "";
				if (!titlePart || !promptPart) {
					ctx.ui.notify("Usage: /task create <title> | <prompt>", "warning");
					return;
				}
				const runAt = new Date(Date.now() + 60_000).toISOString();
				const result = await runPiTask([
					"create",
					"--title",
					titlePart,
					"--prompt",
					promptPart,
					"--at",
					runAt,
					"--cwd",
					ctx.cwd,
					"--security-mode",
					"strict",
				]);
				ctx.ui.notify((result.stdout || result.stderr).slice(0, 2000), result.code === 0 ? "info" : "error");
				return;
			}

			if (
				action === "pick" ||
				((action === "run" || action === "pause" || action === "show") && !parts[1] && ctx.hasUI)
			) {
				const list = await runPiTask(["list"]);
				if (list.code !== 0) {
					ctx.ui.notify(list.stderr || list.stdout || "Failed to list tasks", "error");
					return;
				}
				const tasks = parseTaskLines(list.stdout);
				if (tasks.length === 0) {
					ctx.ui.notify(list.stdout || "No tasks.", "info");
					return;
				}
				const labels = tasks.map((task) => `${task.label} (${task.id.slice(0, 8)})`);
				const chosen = await ctx.ui.select("Select task", labels);
				if (!chosen) return;
				const index = labels.indexOf(chosen);
				const task = tasks[index];
				if (!task) return;
				const next = await ctx.ui.select(`Task ${task.id.slice(0, 8)}`, [
					"run",
					"show",
					"pause",
					"resume",
					"cancel",
				]);
				if (!next) return;
				const result = await runPiTask(
					next === "cancel" ? ["cancel", task.id] : next === "show" ? ["show", task.id] : [next, task.id],
				);
				ctx.ui.notify((result.stdout || result.stderr).slice(0, 2000), result.code === 0 ? "info" : "error");
				return;
			}

			const commandArgs =
				action === "status"
					? ["daemon", "status"]
					: action === "list"
						? ["list"]
						: action === "run" || action === "pause" || action === "resume" || action === "show"
							? [action, parts[1] ?? ""].filter(Boolean)
							: action === "runs"
								? parts[1]
									? ["runs", parts[1]]
									: ["runs"]
								: ["list"];
			if ((action === "run" || action === "pause" || action === "resume" || action === "show") && !parts[1]) {
				ctx.ui.notify("Usage: /task run|pause|resume|show <task-id>  (or /task pick)", "warning");
				return;
			}
			try {
				const result = await runPiTask(commandArgs);
				const text = result.stdout || result.stderr || `(exit ${result.code})`;
				ctx.ui.notify(text.slice(0, 2000), result.code === 0 ? "info" : "error");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
