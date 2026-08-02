/**
 * Interactive Shell Extension
 *
 * Runs interactive terminal programs by attaching them to the current process
 * stdio. Use this for commands that need a real terminal, such as vim, nano,
 * htop, less, or git rebase -i.
 *
 * Usage:
 *   pi --extension examples/extensions/interactive-shell.ts
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const InteractiveShellParams = Type.Object({
	command: Type.String({
		description: "Interactive command to run (e.g., 'vim file.txt', 'htop', 'git rebase -i HEAD~3').",
	}),
	cwd: Type.Optional(Type.String({ description: "Working directory. Default: current session directory." })),
	timeout: Type.Optional(
		Type.Number({
			minimum: 0,
			maximum: 86_400,
			description: "Max seconds to wait. 0 means unlimited. Default: 300.",
		}),
	),
});

function expandPath(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return path.join(homedir(), value.slice(2));
	return value;
}

function runInteractive(
	command: string,
	cwd: string,
	timeoutSeconds: number,
	signal?: AbortSignal,
): Promise<number | null> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.env.SHELL ?? "/bin/bash", ["-lc", command], {
			cwd,
			env: process.env,
			stdio: "inherit",
		});

		let resolved = false;
		let timeoutHandle: NodeJS.Timeout | undefined;

		const finish = (exitCode: number | null) => {
			if (resolved) return;
			resolved = true;
			if (timeoutHandle) clearTimeout(timeoutHandle);
			resolve(exitCode);
		};

		const abort = () => {
			child.kill("SIGTERM");
			finish(null);
		};

		if (signal?.aborted) {
			abort();
			return;
		}
		signal?.addEventListener("abort", abort, { once: true });

		if (timeoutSeconds > 0) {
			timeoutHandle = setTimeout(() => {
				child.kill("SIGTERM");
				finish(null);
			}, timeoutSeconds * 1000);
		}

		child.on("error", (error) => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			reject(error);
		});
		child.on("exit", (exitCode) => finish(exitCode));
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "interactive_shell",
		label: "Interactive Shell",
		description: `Run an interactive terminal program attached to this terminal.

Use this for commands that need stdin/stdout TTY behavior:
- vim, vi, nano, emacs
- htop, top, less, more
- git rebase -i, git add -p, git commit
- REPLs such as python, node, psql, mysql

Do not use it for normal non-interactive shell commands; use bash instead.`,
		promptSnippet: "Use interactive_shell for TTY-based commands such as vim, htop, git add -p, and git rebase -i",
		promptGuidelines: [
			"Use only when the command requires a real terminal or interactive input.",
			"For ordinary commands, prefer the built-in bash tool.",
			"The agent waits until the interactive command exits.",
		],
		parameters: InteractiveShellParams,

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const cwd = path.resolve(ctx.cwd, expandPath(params.cwd ?? "."));
			const timeout = params.timeout ?? 300;

			try {
				const exitCode = await runInteractive(params.command, cwd, timeout, signal);
				const status = exitCode === null ? "terminated" : exitCode === 0 ? "completed" : "failed";
				return {
					content: [
						{
							type: "text",
							text: `Interactive command ${status}: ${params.command}\nExit code: ${exitCode ?? "terminated"}`,
						},
					],
					details: { command: params.command, cwd, timeout, exitCode, status },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `Interactive command failed: ${message}` }],
					details: { command: params.command, cwd, error: message },
				};
			}
		},
	});

	pi.registerTool({
		name: "shell_history",
		label: "Shell History",
		description: "View recent shell history from common shell history files.",
		promptSnippet: "Use shell_history to review recent local shell commands",
		parameters: Type.Object({
			count: Type.Optional(
				Type.Number({ minimum: 1, maximum: 100, description: "Number of recent commands. Default: 20." }),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const count = params.count ?? 20;
			const historyFiles = [path.join(homedir(), ".zsh_history"), path.join(homedir(), ".bash_history")];
			const existing = historyFiles.find((file) => {
				try {
					return fs.existsSync(file);
				} catch {
					return false;
				}
			});

			if (!existing) {
				return { content: [{ type: "text", text: "No shell history file found." }], details: { count: 0 } };
			}

			const { stdout, code } = await pi.exec("tail", [`-n${count}`, existing]);
			if (code !== 0 || !stdout.trim()) {
				return { content: [{ type: "text", text: "No shell history available." }], details: { count: 0 } };
			}

			return { content: [{ type: "text", text: stdout }], details: { count, file: existing } };
		},
	});
}
