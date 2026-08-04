/**
 * Symbol-level code index tool (built-in): regex-based outline/search over
 * source files for the common languages. No LSP or external index required —
 * good enough for symbol discovery and definition candidates.
 *
 * - `code_index outline <path>`: list symbols in a file or directory
 * - `code_index search <query>`: find definition candidates by name
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";

export type SymbolKind =
	| "func"
	| "method"
	| "class"
	| "interface"
	| "type"
	| "struct"
	| "enum"
	| "trait"
	| "const"
	| "var";

export interface CodeSymbol {
	kind: SymbolKind;
	name: string;
	line: number;
}

const SKIPPED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"release",
	".next",
	".nuxt",
	".venv",
	"venv",
	"__pycache__",
	".idea",
	".vscode",
	".pi",
	".reasonix",
	"coverage",
	"out",
	"target",
]);

const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES = 5000;
const MAX_DEPTH = 12;

interface LanguagePatterns {
	extensions: string[];
	patterns: Array<{ kind: SymbolKind; regex: RegExp }>;
}

const LANGUAGES: LanguagePatterns[] = [
	{
		extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
		patterns: [
			{ kind: "func", regex: /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
			{ kind: "func", regex: /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
			{ kind: "const", regex: /export\s+const\s+([A-Za-z_$][\w$]*)/g },
			{ kind: "var", regex: /(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)/g },
			{ kind: "class", regex: /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g },
			{ kind: "interface", regex: /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g },
			{ kind: "type", regex: /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g },
			{ kind: "enum", regex: /(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g },
		],
	},
	{
		extensions: [".go"],
		patterns: [
			{ kind: "func", regex: /func\s+([A-Za-z_]\w*)\s*\(/g },
			{ kind: "method", regex: /func\s+\(\w+\s+[*\w.]+\)\s+([A-Za-z_]\w*)\s*\(/g },
			{ kind: "struct", regex: /type\s+([A-Za-z_]\w*)\s+struct/g },
			{ kind: "interface", regex: /type\s+([A-Za-z_]\w*)\s+interface/g },
			{ kind: "type", regex: /type\s+([A-Za-z_]\w*)\s*=/g },
			{ kind: "const", regex: /const\s+([A-Za-z_]\w*)/g },
			{ kind: "var", regex: /var\s+([A-Za-z_]\w*)/g },
		],
	},
	{
		extensions: [".py", ".pyi"],
		patterns: [
			{ kind: "func", regex: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm },
			{ kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)/gm },
		],
	},
	{
		extensions: [".rs"],
		patterns: [
			{ kind: "func", regex: /(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/g },
			{ kind: "struct", regex: /(?:pub\s+)?struct\s+([A-Za-z_]\w*)/g },
			{ kind: "enum", regex: /(?:pub\s+)?enum\s+([A-Za-z_]\w*)/g },
			{ kind: "trait", regex: /(?:pub\s+)?trait\s+([A-Za-z_]\w*)/g },
			{ kind: "type", regex: /(?:pub\s+)?type\s+([A-Za-z_]\w*)\s*=/g },
			{ kind: "const", regex: /(?:pub\s+)?const\s+([A-Za-z_]\w*)\s*:/g },
		],
	},
	{
		extensions: [".java", ".kt", ".kts"],
		patterns: [
			{
				kind: "class",
				regex: /(?:public\s+|private\s+|protected\s+)?(?:final\s+|abstract\s+)?class\s+([A-Za-z_]\w*)/g,
			},
			{ kind: "interface", regex: /(?:public\s+)?interface\s+([A-Za-z_]\w*)/g },
			{ kind: "enum", regex: /(?:public\s+)?enum\s+([A-Za-z_]\w*)/g },
			{ kind: "method", regex: /(?:public|private|protected)\s+(?:static\s+)?[\w<>,.[\]]+\s+([A-Za-z_]\w*)\s*\(/g },
		],
	},
	{
		extensions: [".c", ".h", ".cpp", ".hpp", ".cc", ".cxx"],
		patterns: [
			{ kind: "struct", regex: /struct\s+([A-Za-z_]\w*)/g },
			{ kind: "type", regex: /typedef\s+.*\s+([A-Za-z_]\w*)\s*;/g },
			{ kind: "func", regex: /^\s*[\w:*]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/gm },
		],
	},
	{
		extensions: [".rb"],
		patterns: [
			{ kind: "func", regex: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*)/gm },
			{ kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)/gm },
			{ kind: "type", regex: /^\s*module\s+([A-Za-z_]\w*)/gm },
		],
	},
];

function patternsFor(file: string): Array<{ kind: SymbolKind; regex: RegExp }> | undefined {
	const lower = file.toLowerCase();
	for (const language of LANGUAGES) {
		if (language.extensions.some((extension) => lower.endsWith(extension))) {
			return language.patterns;
		}
	}
	return undefined;
}

function extractSymbols(file: string, source: string): CodeSymbol[] {
	const patterns = patternsFor(file);
	if (!patterns) return [];
	const symbols: CodeSymbol[] = [];
	for (const { kind, regex } of patterns) {
		// Reset the regex's lastIndex for each pass over the source.
		regex.lastIndex = 0;
		for (let match = regex.exec(source); match !== null; match = regex.exec(source)) {
			const name = match[1];
			if (!name) continue;
			const line = source.slice(0, match.index).split("\n").length;
			symbols.push({ kind, name, line });
			if (match.index === regex.lastIndex) regex.lastIndex += 1;
		}
	}
	// De-duplicate (const/function declarations can match twice).
	const seen = new Set<string>();
	const unique: CodeSymbol[] = [];
	for (const symbol of symbols) {
		const key = `${symbol.kind}:${symbol.name}:${symbol.line}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(symbol);
	}
	return unique;
}

function shouldSkip(name: string): boolean {
	return SKIPPED_DIRS.has(name) || name.startsWith(".");
}

function scanFiles(root: string, depth: number, out: string[], count: { value: number }): void {
	if (depth > MAX_DEPTH || count.value >= MAX_FILES) return;
	let entries: Array<{ name: string; isDir: boolean }>;
	try {
		entries = readdirSync(root, { withFileTypes: true }).map((entry) => ({
			name: entry.name,
			isDir: entry.isDirectory(),
		}));
	} catch {
		return;
	}
	for (const entry of entries) {
		if (count.value >= MAX_FILES) return;
		if (shouldSkip(entry.name)) continue;
		const full = join(root, entry.name);
		if (entry.isDir) {
			scanFiles(full, depth + 1, out, count);
		} else if (patternsFor(full)) {
			try {
				if (statSync(full).size > MAX_FILE_BYTES) continue;
			} catch {
				continue;
			}
			out.push(full);
			count.value += 1;
		}
	}
}

function outlinePath(target: string): { file: string; symbols: CodeSymbol[] }[] {
	let files: string[];
	let stat: ReturnType<typeof statSync>;
	try {
		stat = statSync(target);
	} catch {
		return [];
	}
	if (stat.isFile()) {
		files = patternsFor(target) ? [target] : [];
	} else {
		files = [];
		scanFiles(target, 0, files, { value: 0 });
	}
	const result: Array<{ file: string; symbols: CodeSymbol[] }> = [];
	for (const file of files) {
		let source: string;
		try {
			source = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		const symbols = extractSymbols(file, source);
		if (symbols.length > 0) result.push({ file, symbols });
	}
	return result;
}

const CodeIndexParams = Type.Object({
	action: Type.Union([Type.Literal("outline"), Type.Literal("search"), Type.Literal("refs"), Type.Literal("callers")]),
	path: Type.Optional(Type.String({ description: "File or directory to outline (default: current workspace)" })),
	query: Type.Optional(
		Type.String({
			description: "Symbol name substring to find (for search), or exact identifier (for refs/callers)",
		}),
	),
	kind: Type.Optional(
		Type.String({ description: "Filter by kind: func/method/class/interface/type/struct/enum/trait/const/var" }),
	),
	limit: Type.Optional(Type.Integer({ default: 50, minimum: 1, maximum: 200 })),
});

function textResult(text: string): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cross-file reference search: every word-boundary occurrence of `query`
 * across source files, marking definition lines (from the symbol index).
 */
function findReferences(root: string, query: string): string[] {
	const files: string[] = [];
	scanFiles(root, 0, files, { value: 0 });
	const regex = new RegExp(`\\b${escapeRegExp(query)}\\b`, "g");
	const lines: string[] = [];
	for (const file of files) {
		let source: string;
		try {
			source = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		const symbols = extractSymbols(file, source);
		const definitionLines = new Set(symbols.filter((symbol) => symbol.name === query).map((symbol) => symbol.line));
		const fileLines = source.split("\n");
		regex.lastIndex = 0;
		for (let match = regex.exec(source); match !== null; match = regex.exec(source)) {
			const lineNumber = source.slice(0, match.index).split("\n").length;
			const rawLine = fileLines[lineNumber - 1] ?? "";
			const marker = definitionLines.has(lineNumber) ? "[def]" : "[ref]";
			lines.push(`${marker} ${file}:${lineNumber}: ${rawLine.trim().slice(0, 120)}`);
		}
	}
	return lines;
}

/**
 * Caller search: for each reference to `query`, find the nearest enclosing
 * function/method definition as the (coarse) caller.
 */
function findCallers(root: string, query: string): Array<{ file: string; caller: CodeSymbol; line: number }> {
	const files: string[] = [];
	scanFiles(root, 0, files, { value: 0 });
	const regex = new RegExp(`\\b${escapeRegExp(query)}\\b`, "g");
	const result: Array<{ file: string; caller: CodeSymbol; line: number }> = [];
	for (const file of files) {
		let source: string;
		try {
			source = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		const symbols = extractSymbols(file, source);
		const funcs = symbols.filter((symbol) => symbol.kind === "func" || symbol.kind === "method");
		regex.lastIndex = 0;
		for (let match = regex.exec(source); match !== null; match = regex.exec(source)) {
			const lineNumber = source.slice(0, match.index).split("\n").length;
			// Skip the definition itself.
			if (symbols.some((symbol) => symbol.name === query && symbol.line === lineNumber)) continue;
			// Nearest enclosing function/method before or at this line — the
			// queried function itself can never be its own caller.
			const enclosing = funcs
				.filter((symbol) => symbol.name !== query && symbol.line <= lineNumber)
				.sort((a, b) => b.line - a.line)[0];
			if (enclosing) result.push({ file, caller: enclosing, line: lineNumber });
		}
	}
	return result;
}

export function createCodeIndexToolDefinition(): ToolDefinition<typeof CodeIndexParams, undefined> {
	return {
		name: "code_index",
		label: "Code Index",
		description:
			"Symbol-level code index: outline a file/directory (list funcs, classes, interfaces, types…) or search for symbol definition candidates by name. Fast, no build required.",
		promptSnippet: "code_index - outline or search source symbols",
		promptGuidelines: [
			"Use code_index before reading files to find where symbols are defined, or to discover the shape of an unfamiliar codebase.",
		],
		parameters: CodeIndexParams,
		execute: async (_toolCallId, params) => {
			const root = params.path ?? ".";
			if (params.action === "outline") {
				const outlines = outlinePath(root);
				if (outlines.length === 0) return textResult(`No source symbols found under ${root}.`);
				const lines: string[] = [];
				let shown = 0;
				for (const { file, symbols } of outlines) {
					const display = file === root ? file : relative(process.cwd(), file) || file;
					lines.push(`## ${display}`);
					for (const symbol of symbols) {
						if (params.kind && symbol.kind !== params.kind) continue;
						if (shown >= (params.limit ?? 50)) {
							lines.push("…(limit reached)");
							shown = -1;
							break;
						}
						lines.push(`  ${symbol.kind} ${symbol.name} :${symbol.line}`);
						shown += 1;
					}
					if (shown === -1) break;
				}
				if (shown === 0) return textResult(`No ${params.kind ?? ""} symbols found under ${root}.`.trim());
				return textResult(lines.join("\n"));
			}

			// search
			const query = (params.query ?? "").trim().toLowerCase();
			if (!query) return textResult("(search requires a query)");
			if (params.action === "refs") {
				const refs = findReferences(root, params.query!.trim());
				if (refs.length === 0) return textResult(`No references to "${params.query}" found under ${root}.`);
				const limited = refs.slice(0, params.limit ?? 50);
				const note = refs.length > limited.length ? `\n…(${refs.length - limited.length} more)` : "";
				return textResult(limited.join("\n") + note);
			}
			if (params.action === "callers") {
				const callers = findCallers(root, params.query!.trim());
				if (callers.length === 0) return textResult(`No callers of "${params.query}" found under ${root}.`);
				const seen = new Set<string>();
				const lines: string[] = [];
				for (const { file, caller, line } of callers) {
					const display = file === root ? file : relative(process.cwd(), file) || file;
					const key = `${display}:${caller.name}`;
					if (seen.has(key)) continue;
					seen.add(key);
					lines.push(`${caller.kind} ${caller.name} — ${display}:${caller.line} (calls at :${line})`);
					if (lines.length >= (params.limit ?? 50)) {
						lines.push("…(limit reached)");
						break;
					}
				}
				return textResult(lines.join("\n"));
			}
			const files: string[] = [];
			scanFiles(root, 0, files, { value: 0 });
			const hits: Array<{ file: string; symbol: CodeSymbol }> = [];
			for (const file of files) {
				let source: string;
				try {
					source = readFileSync(file, "utf8");
				} catch {
					continue;
				}
				const symbols = extractSymbols(file, source);
				for (const symbol of symbols) {
					if (symbol.name.toLowerCase().includes(query)) {
						if (params.kind && symbol.kind !== params.kind) continue;
						hits.push({ file, symbol });
					}
				}
			}
			if (hits.length === 0) return textResult(`No symbol matching "${params.query}" found under ${root}.`);
			hits.sort((a, b) => a.file.localeCompare(b.file) || a.symbol.line - b.symbol.line);
			const lines = hits.slice(0, params.limit ?? 50).map(({ file, symbol }) => {
				const display = file === root ? file : relative(process.cwd(), file) || file;
				return `${symbol.kind} ${symbol.name} — ${display}:${symbol.line}`;
			});
			return textResult(lines.join("\n"));
		},
	};
}
