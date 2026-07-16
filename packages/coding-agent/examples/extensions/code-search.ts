/**
 * Code Search Extension
 *
 * Provides a `code_search` tool for searching code by symbol/keyword with
 * language filtering and directory scoping. Uses ripgrep (rg) under the hood
 * with graceful fallback to grep.
 *
 * Features:
 * - Keyword/symbol search across source files
 * - Language filtering (--type for ripgrep)
 * - Path scoping (limit search to a subdirectory)
 * - Max results cap to avoid overwhelming output
 * - Returns matching lines with file path and line number
 *
 * Requirements:
 * - ripgrep (rg) is preferred and installed by default on most systems
 * - Falls back to GNU/BSD grep if rg is unavailable
 *
 * Usage:
 *   pi --extension examples/extensions/code-search.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const CodeSearchParams = Type.Object({
	query: Type.String({ description: "Search query (symbol name, keyword, or regex)" }),
	language: Type.Optional(
		Type.String({ description: "Filter by language (e.g., ts, js, py, rust, go, java). Uses ripgrep --type." }),
	),
	path: Type.Optional(Type.String({ description: "Subdirectory to search within (relative to cwd)" })),
	max_results: Type.Optional(Type.Number({ description: "Maximum results to return (default: 50)", minimum: 1 })),
});

interface CodeSearchDetails {
	total_matches: number;
	tool: "rg" | "grep";
	language_filter?: string;
	path_scope?: string;
}

async function runCmd(
	pi: ExtensionAPI,
	cmd: string,
	args: string[],
	_cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	const result = await pi.exec(cmd, args);
	return {
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		code: result.code ?? 1,
	};
}

async function checkRipgrep(pi: ExtensionAPI): Promise<boolean> {
	try {
		const { code } = await runCmd(pi, "rg", ["--version"], "");
		return code === 0;
	} catch {
		return false;
	}
}

async function rgSearch(
	pi: ExtensionAPI,
	query: string,
	options: { language?: string; pathScope?: string; maxResults?: number },
): Promise<{ output: string; details: CodeSearchDetails }> {
	const args: string[] = ["-n", "-I"]; // show line numbers, ignore binary

	if (options.language) {
		args.push("--type", options.language);
	}

	if (options.pathScope) {
		args.push("-g", `${options.pathScope}/`);
	}

	args.push("-C", "0"); // no context lines
	args.push("-m", String(options.maxResults ?? 50));
	args.push(query);

	const { stdout, stderr } = await runCmd(pi, "rg", args, "");

	const matchCount = stdout.split("\n").filter((l) => l.trim().length > 0 && !l.includes("--")).length;

	return {
		output: stdout || `ripgrep returned no matches or error: ${stderr}`,
		details: {
			total_matches: matchCount,
			tool: "rg",
			language_filter: options.language,
			path_scope: options.pathScope,
		},
	};
}

async function grepSearch(
	pi: ExtensionAPI,
	query: string,
	options: { language?: string; pathScope?: string; maxResults?: number },
): Promise<{ output: string; details: CodeSearchDetails }> {
	const args: string[] = ["-rn", "-I", "--color=never"];

	if (options.language) {
		const extMap: Record<string, string> = {
			ts: ".ts",
			js: ".js",
			py: ".py",
			rust: ".rs",
			go: ".go",
			java: ".java",
			c: ".c",
			h: ".h",
			hpp: ".hpp",
			cpp: ".cpp",
			rb: ".rb",
			php: ".php",
			sh: ".sh",
			yaml: ".yaml",
			yml: ".yml",
			json: ".json",
			md: ".md",
			html: ".html",
			css: ".css",
			sql: ".sql",
		};
		const ext = extMap[options.language];
		if (ext) {
			args.push("--include", `*${ext}`);
		}
	}

	if (options.pathScope) {
		args.push(options.pathScope);
	} else {
		args.push(".");
	}

	args.push(query);

	const { stdout, stderr } = await runCmd(pi, "grep", args, "");

	const lines = stdout.split("\n").filter((l) => l.trim().length > 0 && !l.includes("Binary"));
	const limited = lines.slice(0, options.maxResults ?? 50);

	return {
		output: limited.join("\n") || (stderr ? `grep error: ${stderr}` : "No matches found."),
		details: {
			total_matches: limited.length,
			tool: "grep",
			language_filter: options.language,
			path_scope: options.pathScope,
		},
	};
}

export default function (pi: ExtensionAPI) {
	let rgChecked = false;
	let rgAvailable = false;

	pi.registerTool({
		name: "code_search",
		label: "Code Search",
		description:
			"Search source code files for a keyword, symbol, or pattern. Supports language filtering and directory scoping. Uses ripgrep (fast) with grep fallback.",
		promptSnippet: "Use code_search to find code symbols, keywords, or patterns across source files",
		parameters: CodeSearchParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const query = params.query;
			const maxResults = params.max_results ?? 50;
			const language = params.language;
			const pathScope = params.path;

			// Lazy-check rg availability (cached per extension lifetime)
			if (!rgChecked) {
				rgAvailable = await checkRipgrep(pi);
				rgChecked = true;
			}

			try {
				let result: { output: string; details: CodeSearchDetails };

				if (rgAvailable) {
					result = await rgSearch(pi, query, { language, pathScope, maxResults });
				} else {
					result = await grepSearch(pi, query, { language, pathScope, maxResults });
				}

				return {
					content: [
						{
							type: "text",
							text: result.output || "No matches found.",
						},
					],
					details: result.details,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Error performing code search: ${message}` }],
					details: { total_matches: 0, tool: rgAvailable ? "rg" : "grep" } satisfies CodeSearchDetails,
				};
			}
		},
	});
}
