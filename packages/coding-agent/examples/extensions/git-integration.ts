/**
 * Git Integration Extension
 *
 * Provides git-aware tools for the coding agent: commit, PR description,
 * branch management, blame, and diff analysis.
 *
 * Usage:
 *   pi --extension examples/extensions/git-integration.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// Helpers
// ============================================================================

async function runGit(
	pi: ExtensionAPI,
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return pi.exec("git", args, { cwd });
}

async function getRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const { stdout, code } = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	return code === 0 ? stdout.trim() : null;
}

async function getStatus(
	pi: ExtensionAPI,
	cwd: string,
): Promise<{ files: Array<{ path: string; status: string }>; staged: string[]; unstaged: string[] }> {
	const { stdout } = await runGit(pi, ["status", "--porcelain=v2", "--branch"], cwd);
	const files: Array<{ path: string; status: string }> = [];
	const staged: string[] = [];
	const unstaged: string[] = [];

	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		const parts = line.split(" ");
		if (parts[0]?.startsWith("# branch.head")) continue;
		if (parts[0]?.startsWith("#")) continue;
		if (parts.length < 4) continue;
		const status = parts[1];
		const path = parts.slice(3).join(" ");
		if (!path) continue;
		files.push({ path, status });
		if (status.includes("H")) staged.push(path);
		else if (status.includes("?")) continue;
		else unstaged.push(path);
	}

	return { files, staged, unstaged };
}

async function _getDiff(pi: ExtensionAPI, cwd: string, staged: boolean): Promise<string> {
	const args = staged ? ["diff", "--cached", "-U3"] : ["diff", "-U3"];
	const { stdout } = await runGit(pi, args, cwd);
	return stdout;
}

async function getLog(pi: ExtensionAPI, cwd: string, count: number): Promise<string> {
	const { stdout } = await runGit(pi, ["log", `--max-count=${count}`, "--format=%H%x09%an%x09%ad%x09%s"], cwd);
	return stdout;
}

async function getBlame(pi: ExtensionAPI, cwd: string, file: string, lines?: number[]): Promise<string> {
	const args = ["blame", "-L", "1,-1"];
	if (lines) args.splice(1, 0, `${lines[0]},${lines[1]}`);
	args.push("--", file);
	const { stdout } = await runGit(pi, args, cwd);
	return stdout;
}

function classifyChanges(files: Array<{ path: string; status: string }>): Record<string, string[]> {
	const categorized: Record<string, string[]> = {
		features: [],
		fixes: [],
		refactors: [],
		docs: [],
		chore: [],
	};

	for (const { path, status } of files) {
		if (status.includes("?")) continue;
		const ext = path.split(".").pop()?.toLowerCase() ?? "";
		const isTest =
			path.includes("/test/") || path.includes("/spec/") || path.endsWith(".test.") || path.endsWith(".spec.");
		const isDoc = ["md", "rst", "txt"].includes(ext) || path.includes("/doc/");
		const isConfig =
			path.includes("package.json") ||
			path.includes("tsconfig") ||
			path.includes(".eslintrc") ||
			path.includes(".prettierrc");

		if (isTest) categorized.chore.push(path);
		else if (isDoc) categorized.docs.push(path);
		else if (isConfig) categorized.chore.push(path);
		else if (status.includes("R")) categorized.refactors.push(path);
		else categorized.features.push(path);
	}

	return categorized;
}

// ============================================================================
// Tools
// ============================================================================

const GitCommitParams = Type.Object({
	message: Type.Optional(Type.String({ description: "Commit message. If omitted, generates one automatically." })),
	staged: Type.Optional(
		Type.Boolean({ description: "Only commit staged files. Default: false (commit all tracked changes)." }),
	),
});

const GitPrDescriptionParams = Type.Object({
	base: Type.Optional(Type.String({ description: "Target branch (e.g., main). Default: origin/main." })),
	head: Type.Optional(Type.String({ description: "Current branch name." })),
});

const GitStatusParams = Type.Object({
	detailed: Type.Optional(Type.Boolean({ description: "Include file categorization. Default: false." })),
});

const GitBlameParams = Type.Object({
	file: Type.String({ description: "File path to blame." }),
	lines: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }), { description: "[start, end] line range." })),
});

const GitLogParams = Type.Object({
	count: Type.Optional(
		Type.Number({ minimum: 1, maximum: 100, description: "Number of recent commits. Default: 10." }),
	),
});

const GitBranchParams = Type.Object({
	action: Type.Optional(Type.String({ description: "Action: list, create, delete, switch. Default: list." })),
	name: Type.Optional(Type.String({ description: "Branch name for create/delete/switch." })),
});

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	// --- git_commit ---
	pi.registerTool({
		name: "git_commit",
		label: "Git Commit",
		description: "Stage and commit changes. Can auto-generate a conventional commit message based on changed files.",
		promptSnippet: "Use git_commit to stage and commit changes with conventional commit messages",
		promptGuidelines: [
			"Auto-generate messages using feat/fix/refactor/docs/chore prefixes.",
			"Use imperative mood: 'Add X', not 'Added X'.",
			"Keep subject under 72 characters.",
		],
		parameters: GitCommitParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const repoRoot = await getRepoRoot(pi, cwd);
			if (!repoRoot) {
				return { content: [{ type: "text", text: "Not a git repository." }], details: { error: "not-git-repo" } };
			}

			const status = await getStatus(pi, repoRoot);

			// Stage files
			if (status.unstaged.length > 0) {
				await pi.exec("git", ["add", "--", ...status.unstaged], { cwd: repoRoot });
			}

			// Generate commit message
			const message =
				params.message ??
				(() => {
					const categorized = classifyChanges(status.files);
					const parts: string[] = [];

					if (categorized.features.length > 0) {
						parts.push(
							`feat: ${categorized.features
								.slice(0, 3)
								.map((f) => f.split("/").pop())
								.join(", ")}`,
						);
					}
					if (categorized.fixes.length > 0) {
						parts.push(
							`fix: ${categorized.fixes
								.slice(0, 3)
								.map((f) => f.split("/").pop())
								.join(", ")}`,
						);
					}
					if (categorized.refactors.length > 0) {
						parts.push(
							`refactor: ${categorized.refactors
								.slice(0, 3)
								.map((f) => f.split("/").pop())
								.join(", ")}`,
						);
					}
					if (categorized.docs.length > 0) {
						parts.push(
							`docs: ${categorized.docs
								.slice(0, 3)
								.map((f) => f.split("/").pop())
								.join(", ")}`,
						);
					}
					if (categorized.chore.length > 0) {
						parts.push(
							`chore: ${categorized.chore
								.slice(0, 3)
								.map((f) => f.split("/").pop())
								.join(", ")}`,
						);
					}

					return parts[0] ?? "chore: update files";
				})();

			// Commit
			const result = await pi.exec("git", ["commit", "-m", message], { cwd: repoRoot });
			if (result.code !== 0) {
				return {
					content: [{ type: "text", text: `Commit failed: ${result.stderr}` }],
					details: { error: "commit-failed" },
				};
			}

			return {
				content: [{ type: "text", text: `Committed: ${message}` }],
				details: { message, filesChanged: status.files.length },
			};
		},
	});

	// --- git_pr_description ---
	pi.registerTool({
		name: "git_pr_description",
		label: "Git PR Description",
		description: "Generate a PR description from git diff between branches.",
		promptSnippet: "Use git_pr_description to generate a PR description from branch diff",
		parameters: GitPrDescriptionParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const repoRoot = await getRepoRoot(pi, cwd);
			if (!repoRoot) {
				return { content: [{ type: "text", text: "Not a git repository." }], details: { error: "not-git-repo" } };
			}

			const base = params.base ?? "origin/main";
			const head =
				params.head ??
				(await pi.exec("git", ["branch", "--show-current"], { cwd: repoRoot }).then((r) => r.stdout.trim()));

			const { stdout: diff } = await pi.exec("git", ["diff", `${base}...${head}`, "-U3"], { cwd: repoRoot });

			// Categorize changed files
			const { stdout: statusOut } = await pi.exec("git", ["diff", "--name-status", `${base}...${head}`], {
				cwd: repoRoot,
			});
			const files = statusOut
				.split("\n")
				.filter(Boolean)
				.map((line) => {
					const [status, path] = line.split("\t");
					return { status: status ?? "?", path: path ?? "" };
				});

			const categorized = classifyChanges(
				files.map((f) => ({ path: f.path, status: f.status === "A" ? "A" : f.status === "D" ? "D" : "M" })),
			);

			// Generate description
			const sections: string[] = [];

			if (categorized.features.length > 0) {
				sections.push(`### 🚀 Features\n${categorized.features.map((f) => `- \`${f}\``).join("\n")}`);
			}
			if (categorized.fixes.length > 0) {
				sections.push(`### 🐛 Fixes\n${categorized.fixes.map((f) => `- \`${f}\``).join("\n")}`);
			}
			if (categorized.refactors.length > 0) {
				sections.push(`### 🔧 Refactors\n${categorized.refactors.map((f) => `- \`${f}\``).join("\n")}`);
			}
			if (categorized.docs.length > 0) {
				sections.push(`### 📝 Docs\n${categorized.docs.map((f) => `- \`${f}\``).join("\n")}`);
			}
			if (categorized.chore.length > 0) {
				sections.push(`### 🧹 Chore\n${categorized.chore.map((f) => `- \`${f}\``).join("\n")}`);
			}

			const summary = diff
				.split("\n")
				.filter((l) => l.startsWith("+") && !l.startsWith("+++"))
				.slice(0, 20)
				.map((l) => l.slice(1))
				.join("\n");

			const description = [
				`## Summary\n\nChanges between \`${base}\` and \`${head}\`.`,
				...sections,
				`\n### Code Changes\n\n\`\`\`diff\n${summary}\n\`\`\``,
			].join("\n");

			return {
				content: [{ type: "text", text: description }],
				details: { base, head, sections: sections.length },
			};
		},
	});

	// --- git_status ---
	pi.registerTool({
		name: "git_status",
		label: "Git Status",
		description: "Show git status with file categorization.",
		promptSnippet: "Use git_status to see current working tree state",
		parameters: GitStatusParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const repoRoot = await getRepoRoot(pi, cwd);
			if (!repoRoot) {
				return { content: [{ type: "text", text: "Not a git repository." }], details: { error: "not-git-repo" } };
			}

			const status = await getStatus(pi, repoRoot);
			const detailed = params.detailed ?? false;

			let output = `Staged: ${status.staged.length} | Unstaged: ${status.unstaged.length} | Total: ${status.files.length}\n\n`;

			if (status.staged.length > 0) {
				output += `Staged:\n${status.staged.map((f) => `  M ${f}`).join("\n")}\n\n`;
			}
			if (status.unstaged.length > 0) {
				output += `Unstaged:\n${status.unstaged.map((f) => `  M ${f}`).join("\n")}\n\n`;
			}

			if (detailed) {
				const categorized = classifyChanges(status.files);
				for (const [category, files] of Object.entries(categorized)) {
					if (files.length > 0) {
						output += `${category}: ${files.join(", ")}\n`;
					}
				}
			}

			return {
				content: [{ type: "text", text: output.trim() }],
				details: { staged: status.staged.length, unstaged: status.unstaged.length },
			};
		},
	});

	// --- git_blame ---
	pi.registerTool({
		name: "git_blame",
		label: "Git Blame",
		description: "Show who last modified each line of a file.",
		promptSnippet: "Use git_blame to see line-by-line authorship",
		parameters: GitBlameParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const repoRoot = await getRepoRoot(pi, cwd);
			if (!repoRoot) {
				return { content: [{ type: "text", text: "Not a git repository." }], details: { error: "not-git-repo" } };
			}

			const blameOutput = await getBlame(pi, repoRoot, params.file, params.lines);

			return {
				content: [{ type: "text", text: blameOutput }],
				details: { file: params.file },
			};
		},
	});

	// --- git_log ---
	pi.registerTool({
		name: "git_log",
		label: "Git Log",
		description: "Show recent commit history.",
		promptSnippet: "Use git_log to see recent commits",
		parameters: GitLogParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const repoRoot = await getRepoRoot(pi, cwd);
			if (!repoRoot) {
				return { content: [{ type: "text", text: "Not a git repository." }], details: { error: "not-git-repo" } };
			}

			const count = params.count ?? 10;
			const logOutput = await getLog(pi, repoRoot, count);

			return {
				content: [{ type: "text", text: logOutput }],
				details: { count },
			};
		},
	});

	// --- git_branch ---
	pi.registerTool({
		name: "git_branch",
		label: "Git Branch",
		description: "List, create, delete, or switch git branches.",
		promptSnippet: "Use git_branch to manage branches",
		parameters: GitBranchParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const repoRoot = await getRepoRoot(pi, cwd);
			if (!repoRoot) {
				return { content: [{ type: "text", text: "Not a git repository." }], details: { error: "not-git-repo" } };
			}

			const action = params.action ?? "list";
			const name = params.name;

			switch (action) {
				case "list": {
					const { stdout } = await pi.exec("git", ["branch", "-v"], { cwd: repoRoot });
					return { content: [{ type: "text", text: stdout }], details: { action: "list" } };
				}
				case "create": {
					if (!name)
						return {
							content: [{ type: "text", text: "Branch name required." }],
							details: { error: "missing-name" },
						};
					await pi.exec("git", ["checkout", "-b", name], { cwd: repoRoot });
					return {
						content: [{ type: "text", text: `Created branch: ${name}` }],
						details: { action: "create", name },
					};
				}
				case "delete": {
					if (!name)
						return {
							content: [{ type: "text", text: "Branch name required." }],
							details: { error: "missing-name" },
						};
					const { code, stderr } = await pi.exec("git", ["branch", "-d", name], { cwd: repoRoot });
					if (code !== 0) {
						return {
							content: [{ type: "text", text: `Failed: ${stderr}` }],
							details: { error: "delete-failed" },
						};
					}
					return {
						content: [{ type: "text", text: `Deleted branch: ${name}` }],
						details: { action: "delete", name },
					};
				}
				case "switch": {
					if (!name)
						return {
							content: [{ type: "text", text: "Branch name required." }],
							details: { error: "missing-name" },
						};
					const { code, stderr } = await pi.exec("git", ["checkout", name], { cwd: repoRoot });
					if (code !== 0) {
						return {
							content: [{ type: "text", text: `Failed: ${stderr}` }],
							details: { error: "switch-failed" },
						};
					}
					return {
						content: [{ type: "text", text: `Switched to: ${name}` }],
						details: { action: "switch", name },
					};
				}
				default:
					return {
						content: [{ type: "text", text: `Unknown action: ${action}` }],
						details: { error: "invalid-action" },
					};
			}
		},
	});

	// --- session_before_compact: save git state ---
	pi.on("session_before_compact", async (_event, ctx) => {
		const repoRoot = await getRepoRoot(pi, ctx.cwd);
		if (!repoRoot) return undefined;

		try {
			const { stdout: commit } = await pi.exec("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
			const { stdout: branch } = await pi.exec("git", ["branch", "--show-current"], { cwd: repoRoot });

			pi.appendEntry("git:checkpoint", {
				commit: commit.trim(),
				branch: branch.trim(),
				timestamp: new Date().toISOString(),
			});
		} catch {
			// Not a git repo or error
		}

		return undefined;
	});
}
