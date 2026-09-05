/**
 * Auto-summary for large files in the read tool.
 *
 * When reading files with >1000 lines (or >100KB) where no explicit offset or limit
 * was specified, intercepts the read tool result to provide an intelligent,
 * structured summary (AST-like outline of classes/interfaces/functions for code,
 * top-level key & schema distribution for JSON, column schema for CSV, and heading
 * outline for Markdown) rather than overflowing the model's context.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface CodeOutline {
	classes: Array<{ name: string; extends?: string; methods?: string[] }>;
	interfaces: string[];
	types: string[];
	functions: string[];
}

export interface JsonOutline {
	rootType: "object" | "array" | "other";
	totalKeys?: number;
	length?: number;
	keySummary?: string[];
	sampleKeys?: string[];
}

export interface CsvOutline {
	delimiter: string;
	columns: string[];
	totalRows: number;
}

export interface MarkdownHeading {
	level: number;
	title: string;
}

export interface FileSummary {
	kind: "code" | "json" | "csv" | "markdown" | "generic";
	filePath: string;
	totalLines: number;
	totalBytes: number;
	sampleFirstLines: string[];
	sampleLastLines: string[];
	codeOutline?: CodeOutline;
	jsonOutline?: JsonOutline;
	csvOutline?: CsvOutline;
	headings?: MarkdownHeading[];
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function extractCodeOutline(lines: string[]): CodeOutline {
	const classes: Array<{ name: string; extends?: string; methods?: string[] }> = [];
	const interfaces: string[] = [];
	const types: string[] = [];
	const functions: string[] = [];

	let currentClass: { name: string; extends?: string; methods: string[] } | null = null;
	let braceDepth = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!.trim();

		// Track braces for class methods
		if (line.includes("{")) braceDepth += (line.match(/{/g) || []).length;
		if (line.includes("}")) {
			braceDepth -= (line.match(/}/g) || []).length;
			if (braceDepth <= 0 && currentClass) {
				classes.push({
					name: currentClass.name,
					extends: currentClass.extends,
					methods: currentClass.methods.slice(0, 8),
				});
				currentClass = null;
			}
		}

		// Python class (e.g. class Foo(threading.Thread):)
		const pyClassMatch = line.match(/^class\s+([A-Za-z0-9_]+)(?:\(([^)]*)\))?:/);
		if (pyClassMatch) {
			classes.push({
				name: pyClassMatch[1]!,
				extends: pyClassMatch[2]?.trim() || undefined,
				methods: [],
			});
			continue;
		}

		// TypeScript / JS / Java / C# / PHP class
		const classMatch = line.match(
			/(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)(?:\s+extends\s+([A-Za-z0-9_]+))?/,
		);
		if (classMatch) {
			currentClass = {
				name: classMatch[1]!,
				extends: classMatch[2],
				methods: [],
			};
			continue;
		}

		// If inside a class, look for methods
		if (currentClass && braceDepth > 0) {
			const methodMatch = line.match(
				/^(?:public|private|protected|async|static|\s)*([a-zA-Z0-9_]+)\s*\(([^)]*)\)(?:\s*:\s*[^;{]+)?\s*[{;]/,
			);
			if (methodMatch && !["if", "for", "while", "switch", "catch", "constructor"].includes(methodMatch[1]!)) {
				currentClass.methods.push(methodMatch[1]!);
				continue;
			}
		}

		// Interface
		const ifaceMatch = line.match(/(?:export\s+)?interface\s+([A-Za-z0-9_]+)/);
		if (ifaceMatch) {
			interfaces.push(ifaceMatch[1]!);
			continue;
		}

		// Type alias
		const typeMatch = line.match(/(?:export\s+)?type\s+([A-Za-z0-9_]+)\s*=/);
		if (typeMatch) {
			types.push(typeMatch[1]!);
			continue;
		}

		// Functions (TS/JS/Go/Rust/Python)
		const fnMatch = line.match(
			/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/,
		);
		if (fnMatch) {
			const args = fnMatch[2]!.length > 40 ? `${fnMatch[2]!.slice(0, 37)}...` : fnMatch[2]!;
			functions.push(`${fnMatch[1]}(${args})`);
			continue;
		}

		const pyFnMatch = line.match(/^def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
		if (pyFnMatch) {
			const rawLine = lines[i]!;
			const isIndented = /^\s+/.test(rawLine);
			if (isIndented && classes.length > 0) {
				const lastClass = classes[classes.length - 1];
				if (lastClass && (!lastClass.methods || lastClass.methods.length < 8)) {
					lastClass.methods = lastClass.methods || [];
					lastClass.methods.push(pyFnMatch[1]!);
					continue;
				}
			}
			const args = pyFnMatch[2]!.length > 40 ? `${pyFnMatch[2]!.slice(0, 37)}...` : pyFnMatch[2]!;
			functions.push(`${pyFnMatch[1]}(${args})`);
			continue;
		}

		const goFnMatch = line.match(/^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
		if (goFnMatch) {
			functions.push(`${goFnMatch[1]}(...)`);
			continue;
		}

		const rustFnMatch = line.match(/(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
		if (rustFnMatch) {
			functions.push(`${rustFnMatch[1]}(...)`);
			continue;
		}
	}

	if (currentClass) {
		classes.push({
			name: currentClass.name,
			extends: currentClass.extends,
			methods: currentClass.methods.slice(0, 8),
		});
	}

	return {
		classes: classes.slice(0, 15),
		interfaces: interfaces.slice(0, 20),
		types: types.slice(0, 20),
		functions: functions.slice(0, 25),
	};
}

export function extractJsonOutline(content: string): JsonOutline {
	// First try clean JSON parse (with trailing comma cleanup)
	try {
		const cleaned = content.replace(/,\s*([}\]])/g, "$1");
		const parsed = JSON.parse(cleaned);
		if (Array.isArray(parsed)) {
			const length = parsed.length;
			let sampleKeys: string[] = [];
			if (length > 0 && typeof parsed[0] === "object" && parsed[0] !== null && !Array.isArray(parsed[0])) {
				sampleKeys = Object.keys(parsed[0]).slice(0, 12);
			}
			return {
				rootType: "array",
				length,
				sampleKeys,
			};
		}
		if (typeof parsed === "object" && parsed !== null) {
			const keys = Object.keys(parsed);
			const keySummary = keys.slice(0, 25).map((k) => {
				const val = parsed[k];
				if (Array.isArray(val)) return `"${k}": Array[${val.length}]`;
				if (typeof val === "object" && val !== null) {
					return `"${k}": Object (${Object.keys(val).length} keys)`;
				}
				return `"${k}": ${typeof val}`;
			});
			return {
				rootType: "object",
				totalKeys: keys.length,
				keySummary,
			};
		}
	} catch {}

	// Fallback pattern matching for JSONL or non-strict JSON
	const keyMatches = Array.from(content.matchAll(/"([a-zA-Z0-9_.-]+)"\s*:/g)).map((m) => m[1]!);
	if (keyMatches.length > 0) {
		const counts = new Map<string, number>();
		for (const k of keyMatches) counts.set(k, (counts.get(k) ?? 0) + 1);
		const topKeys = Array.from(counts.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, 20)
			.map(([k, count]) => `"${k}" (${count} occurrences)`);
		return {
			rootType: "object",
			totalKeys: counts.size,
			keySummary: topKeys,
		};
	}

	return { rootType: "other" };
}

export function extractCsvOutline(lines: string[]): CsvOutline | undefined {
	if (lines.length < 2) return undefined;
	const firstLine = lines[0]!.trim();
	const delimiter = firstLine.includes("\t") ? "\t" : ",";
	const columns = firstLine.split(delimiter).map((c) => c.replace(/^["']|["']$/g, "").trim());
	if (columns.length <= 1) return undefined;
	return {
		delimiter: delimiter === "\t" ? "tab" : "comma",
		columns,
		totalRows: Math.max(0, lines.length - 1),
	};
}

export function extractMarkdownHeadings(lines: string[]): MarkdownHeading[] {
	const headings: MarkdownHeading[] = [];
	for (const line of lines) {
		const m = line.match(/^(#{1,6})\s+(.+)$/);
		if (m) {
			headings.push({ level: m[1]!.length, title: m[2]!.trim() });
		}
	}
	return headings.slice(0, 30);
}

export function generateFileSummary(filePath: string, allLines: string[]): FileSummary {
	const totalLines = allLines.length;
	const totalBytes = Buffer.byteLength(allLines.join("\n"), "utf-8");
	const sampleFirstLines = allLines.slice(0, 10);
	const sampleLastLines = totalLines > 15 ? allLines.slice(-5) : [];
	const ext = extname(filePath).toLowerCase();

	// 1. JSON
	if (ext === ".json" || ext === ".json5" || ext === ".jsonl") {
		const jsonOutline = extractJsonOutline(allLines.join("\n"));
		return {
			kind: "json",
			filePath,
			totalLines,
			totalBytes,
			sampleFirstLines,
			sampleLastLines,
			jsonOutline,
		};
	}

	// 2. CSV / TSV
	if (ext === ".csv" || ext === ".tsv") {
		const csvOutline = extractCsvOutline(allLines);
		if (csvOutline) {
			return {
				kind: "csv",
				filePath,
				totalLines,
				totalBytes,
				sampleFirstLines,
				sampleLastLines,
				csvOutline,
			};
		}
	}

	// 3. Markdown
	if (ext === ".md" || ext === ".markdown") {
		const headings = extractMarkdownHeadings(allLines);
		return {
			kind: "markdown",
			filePath,
			totalLines,
			totalBytes,
			sampleFirstLines,
			sampleLastLines,
			headings,
		};
	}

	// 4. Code files
	const codeExts = new Set([
		".ts",
		".tsx",
		".js",
		".jsx",
		".mjs",
		".cjs",
		".py",
		".go",
		".rs",
		".java",
		".c",
		".cpp",
		".h",
		".hpp",
		".cs",
		".php",
		".rb",
		".swift",
		".kt",
		".vue",
		".svelte",
	]);

	if (codeExts.has(ext)) {
		const codeOutline = extractCodeOutline(allLines);
		return {
			kind: "code",
			filePath,
			totalLines,
			totalBytes,
			sampleFirstLines,
			sampleLastLines,
			codeOutline,
		};
	}

	return {
		kind: "generic",
		filePath,
		totalLines,
		totalBytes,
		sampleFirstLines,
		sampleLastLines,
	};
}

export function formatFileSummary(summary: FileSummary): string {
	const out: string[] = [
		`[File: ${summary.filePath} (${summary.totalLines} lines, ${formatBytes(summary.totalBytes)}) — Auto-Summary Mode]`,
	];

	if (summary.kind === "code" && summary.codeOutline) {
		const { classes, interfaces, types, functions } = summary.codeOutline;
		out.push("\nCode Outline:");
		if (classes.length > 0) {
			out.push("  • Classes:");
			for (const cls of classes) {
				const ext = cls.extends ? ` extends ${cls.extends}` : "";
				const methods = cls.methods && cls.methods.length > 0 ? ` (methods: ${cls.methods.join(", ")})` : "";
				out.push(`    - class ${cls.name}${ext}${methods}`);
			}
		}
		if (interfaces.length > 0) {
			out.push(`  • Interfaces: ${interfaces.join(", ")}`);
		}
		if (types.length > 0) {
			out.push(`  • Type Definitions: ${types.join(", ")}`);
		}
		if (functions.length > 0) {
			out.push("  • Functions / Signatures:");
			for (const fn of functions) {
				out.push(`    - ${fn}`);
			}
		}
	} else if (summary.kind === "json" && summary.jsonOutline) {
		out.push("\nJSON Structure:");
		if (summary.jsonOutline.rootType === "array") {
			out.push(`  • Root: Array with ${summary.jsonOutline.length} items`);
			if (summary.jsonOutline.sampleKeys && summary.jsonOutline.sampleKeys.length > 0) {
				out.push(`  • Item Fields: { ${summary.jsonOutline.sampleKeys.join(", ")} }`);
			}
		} else if (summary.jsonOutline.rootType === "object") {
			out.push(`  • Root: Object with ${summary.jsonOutline.totalKeys} top-level keys`);
			if (summary.jsonOutline.keySummary) {
				out.push("  • Key Summary:");
				for (const k of summary.jsonOutline.keySummary) {
					out.push(`    - ${k}`);
				}
			}
		}
	} else if (summary.kind === "csv" && summary.csvOutline) {
		out.push("\nCSV Structure:");
		out.push(`  • Columns (${summary.csvOutline.columns.length}): ${summary.csvOutline.columns.join(", ")}`);
		out.push(`  • Total Data Rows: ${summary.csvOutline.totalRows}`);
	} else if (summary.kind === "markdown" && summary.headings) {
		out.push("\nDocument Headings:");
		for (const h of summary.headings) {
			const indent = "  ".repeat(h.level);
			out.push(`${indent}• ${h.title}`);
		}
	}

	out.push("\nFirst 10 lines preview:");
	for (let i = 0; i < summary.sampleFirstLines.length; i++) {
		out.push(`  ${i + 1}: ${summary.sampleFirstLines[i]}`);
	}

	if (summary.sampleLastLines.length > 0) {
		out.push("\nLast 5 lines preview:");
		const startIdx = summary.totalLines - summary.sampleLastLines.length + 1;
		for (let i = 0; i < summary.sampleLastLines.length; i++) {
			out.push(`  ${startIdx + i}: ${summary.sampleLastLines[i]}`);
		}
	}

	out.push(
		`\n[Auto-summarized: file has ${summary.totalLines} lines. Use offset=<N> limit=<M> with read tool to inspect specific line ranges.]`,
	);

	return out.join("\n");
}

export default function autoSummaryExtension(pi: ExtensionAPI): void {
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "read" || event.isError) return;
		const path = typeof event.input?.path === "string" ? event.input.path : undefined;
		if (!path) return;
		const offset = event.input?.offset;
		const limit = event.input?.limit;
		// If caller specifically requested an offset or limit range, let built-in read deliver exactly that range.
		if (offset !== undefined || limit !== undefined) return;

		const fullPath = isAbsolute(path) ? path : resolve(ctx.cwd, path);
		if (!existsSync(fullPath)) return;
		try {
			const stat = statSync(fullPath);
			if (stat.isDirectory()) return;

			// Quick size check: files under 32KB rarely exceed 1000 lines, skip reading full file if tiny.
			if (stat.size < 32 * 1024) return;

			const content = readFileSync(fullPath, "utf8");
			const lines = content.split("\n");
			if (lines.length <= 1000 && stat.size < 100 * 1024) return;

			const summary = generateFileSummary(path, lines);
			return {
				content: [{ type: "text", text: formatFileSummary(summary) }],
			};
		} catch {
			return;
		}
	});
}
