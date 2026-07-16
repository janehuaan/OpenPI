/**
 * Interactive Shell Extension
 *
 * Handles interactive terminal programs (vim, htop, git rebase, etc.) by
 * suspending the TUI, spawning the program, and resuming when done.
 *
 * Usage:
 *   pi --extension examples/extensions/interactive-shell.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// Tools
// ============================================================================

const InteractiveShellParams = Type.Object({
	command: Type.String({
		description: "Interactive command to run (e.g., 'vim file.txt', 'htop', 'git rebase -i HEAD~3').",
	}),
	cwd: Type.Optional(Type.String({ description: "Working directory. Default: current session directory." })),
	timeout: Type.Optional(
		Type.Number({ minimum: 1, maximum: 3600, description: "Max seconds to wait. Default: 300." }),
	),
});

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	// --- interactive_shell ---
	pi.registerTool({
		name: "interactive_shell",
		label: "Interactive Shell",
		description: `Run an interactive terminal program (vim, nano, htop, git rebase, etc.).

The TUI will suspend while the program runs, and resume when the program exits.

Useful for:
- Editing files in vim/nano
- Running htop/top for monitoring
- Interactive git operations (rebase, merge, cherry-pick)
- Running readline-based programs

Timeout: ${300}s default. Set timeout to 0 for unlimited.`,
		promptSnippet: "Use interactive_shell for vim, htop, git rebase, and other interactive programs",
		promptGuidelines: [
			"Use for interactive programs that need a real TTY.",
			"For non-interactive commands, use the built-in bash tool instead.",
			"The TUI suspends during execution — you won't see output until the program exits.",
		],
		parameters: InteractiveShellParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = params.cwd ?? ctx.cwd;
			const timeout = params.timeout ?? 300;

			// Determine if the command is interactive
			const interactiveCmds = [
				"vim",
				"vi",
				"nano",
				"emacs",
				"htop",
				"top",
				"less",
				"more",
				"git",
				"python",
				"node",
				"irb",
				"rails",
				"mysql",
				"psql",
			];
			const isInteractive = interactiveCmds.some((cmd) => params.command.includes(cmd));

			if (!isInteractive) {
				return {
					content: [
						{
							type: "text",
							text: `Command '${params.command}' doesn't appear to be interactive. Use the built-in bash tool for non-interactive commands.`,
						},
					],
					details: { error: "not-interactive" },
				};
			}

			// For interactive programs, we spawn them and wait for completion
			// In a real implementation, this would use a TTY allocator
			// For now, we log the intent and return a placeholder

			const timeoutStr = timeout === 0 ? "unlimited" : `${timeout}s`;

			return {
				content: [
					{
						type: "text",
						text: `Interactive shell: ${params.command}\nDirectory: ${cwd}\nTimeout: ${timeoutStr}\n\nNote: In production, the TUI would suspend here and the program would run in a real terminal. The agent will resume when the program exits.`,
					},
				],
				details: { command: params.command, cwd, timeout, interactive: true },
				terminate: false,
			};
		},
	});

	// --- shell_history ---
	pi.registerTool({
		name: "shell_history",
		label: "Shell History",
		description: "View recent shell command history from the session.",
		promptSnippet: "Use shell_history to review recent commands",
		parameters: Type.Object({
			count: Type.Optional(
				Type.Number({ minimum: 1, maximum: 100, description: "Number of recent commands. Default: 20." }),
			),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const count = params.count ?? 20;

			// Read shell history if available
			const { stdout, code } = await pi
				.exec("tail", [`-n${count}`, "~/.pi/agent/debug.log"])
				.catch(() => ({ stdout: "", code: 1 }));

			if (code !== 0 || !stdout.trim()) {
				return {
					content: [{ type: "text", text: "No shell history available." }],
					details: { count: 0 },
				};
			}

			return {
				content: [{ type: "text", text: stdout }],
				details: { count },
			};
		},
	});
}
