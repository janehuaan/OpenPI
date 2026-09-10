import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";

export type SymbolKind = "function" | "class" | "interface" | "type" | "enum" | "variable" | "struct" | "trait";

export interface CodeSymbol {
	name: string;
	kind: SymbolKind;
	filePath: string;
	line: number;
	exportScope?: "export" | "default" | "local";
	signature?: string;
}

export interface SymbolReference {
	filePath: string;
	line: number;
	lineContent: string;
	callerContext?: string;
}

const SUPPORTED_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".go",
	".rs",
]);

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".turbo",
	".gemini",
	"coverage",
	"tmp",
]);

/**
 * Extracts symbols from source code text using fast AST-pattern token matching.
 */
export function extractSymbolsFromSource(content: string, filePath: string): CodeSymbol[] {
	const ext = extname(filePath).toLowerCase();
	const lines = content.split("\n");
	const symbols: CodeSymbol[] = [];

	if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) continue;

			// export [async] function name
			const fnMatch = trimmed.match(/^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/);
			if (fnMatch?.[1]) {
				symbols.push({
					name: fnMatch[1],
					kind: "function",
					filePath,
					line: i + 1,
					exportScope: trimmed.startsWith("export default") ? "default" : trimmed.startsWith("export") ? "export" : "local",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}

			// export const/let/var name = [async] (args) =>
			const arrowMatch = trimmed.match(
				/^(export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*(?::\s*[^=]+)?\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/,
			);
			if (arrowMatch?.[2]) {
				symbols.push({
					name: arrowMatch[2],
					kind: "function",
					filePath,
					line: i + 1,
					exportScope: arrowMatch[1] ? "export" : "local",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}

			// export class name
			const classMatch = trimmed.match(/^(?:export\s+(?:default\s+)?)?class\s+([a-zA-Z0-9_$]+)/);
			if (classMatch?.[1]) {
				symbols.push({
					name: classMatch[1],
					kind: "class",
					filePath,
					line: i + 1,
					exportScope: trimmed.startsWith("export default") ? "default" : trimmed.startsWith("export") ? "export" : "local",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}

			// export interface name
			const ifaceMatch = trimmed.match(/^(?:export\s+)?interface\s+([a-zA-Z0-9_$]+)/);
			if (ifaceMatch?.[1]) {
				symbols.push({
					name: ifaceMatch[1],
					kind: "interface",
					filePath,
					line: i + 1,
					exportScope: trimmed.startsWith("export") ? "export" : "local",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}

			// export type name =
			const typeMatch = trimmed.match(/^(?:export\s+)?type\s+([a-zA-Z0-9_$]+)\s*(?:<[^>]+>)?\s*=/);
			if (typeMatch?.[1]) {
				symbols.push({
					name: typeMatch[1],
					kind: "type",
					filePath,
					line: i + 1,
					exportScope: trimmed.startsWith("export") ? "export" : "local",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}

			// export enum name
			const enumMatch = trimmed.match(/^(?:export\s+)?enum\s+([a-zA-Z0-9_$]+)/);
			if (enumMatch?.[1]) {
				symbols.push({
					name: enumMatch[1],
					kind: "enum",
					filePath,
					line: i + 1,
					exportScope: trimmed.startsWith("export") ? "export" : "local",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}
		}
	} else if (ext === ".py") {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;

			// [async] def name(...)
			const pyFn = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(/);
			if (pyFn?.[1]) {
				symbols.push({
					name: pyFn[1],
					kind: "function",
					filePath,
					line: i + 1,
					exportScope: pyFn[1].startsWith("_") ? "local" : "export",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}

			// class Name(...)
			const pyClass = trimmed.match(/^class\s+([a-zA-Z0-9_]+)/);
			if (pyClass?.[1]) {
				symbols.push({
					name: pyClass[1],
					kind: "class",
					filePath,
					line: i + 1,
					exportScope: pyClass[1].startsWith("_") ? "local" : "export",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}
		}
	} else if (ext === ".go") {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("//")) continue;

			// func [(receiver)] Name(...)
			const goFn = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)\s*\(/);
			if (goFn?.[1]) {
				const isExported = goFn[1][0] === goFn[1][0].toUpperCase();
				symbols.push({
					name: goFn[1],
					kind: "function",
					filePath,
					line: i + 1,
					exportScope: isExported ? "export" : "local",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}

			// type Name struct / interface
			const goType = trimmed.match(/^type\s+([a-zA-Z0-9_]+)\s+(struct|interface)/);
			if (goType?.[1] && goType?.[2]) {
				const isExported = goType[1][0] === goType[1][0].toUpperCase();
				symbols.push({
					name: goType[1],
					kind: goType[2] === "struct" ? "struct" : "interface",
					filePath,
					line: i + 1,
					exportScope: isExported ? "export" : "local",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}
		}
	} else if (ext === ".rs") {
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("//")) continue;

			// [pub] [async] fn name
			const rsFn = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/);
			if (rsFn?.[1]) {
				symbols.push({
					name: rsFn[1],
					kind: "function",
					filePath,
					line: i + 1,
					exportScope: trimmed.startsWith("pub") ? "export" : "local",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}

			// [pub] struct / enum / trait name
			const rsType = trimmed.match(/^(?:pub\s+)?(struct|enum|trait)\s+([a-zA-Z0-9_]+)/);
			if (rsType?.[1] && rsType?.[2]) {
				symbols.push({
					name: rsType[2],
					kind: rsType[1] as SymbolKind,
					filePath,
					line: i + 1,
					exportScope: trimmed.startsWith("pub") ? "export" : "local",
					signature: line.trim().slice(0, 100),
				});
				continue;
			}
		}
	}

	return symbols;
}

/**
 * In-memory index of symbols and references across a workspace.
 */
export class WorkspaceSymbolIndexer {
	private symbolsByName = new Map<string, CodeSymbol[]>();
	private symbolsByFile = new Map<string, CodeSymbol[]>();
	private workspaceRoot: string;

	constructor(workspaceRoot: string) {
		this.workspaceRoot = workspaceRoot;
	}

	public get symbolCount(): number {
		let count = 0;
		for (const list of this.symbolsByName.values()) {
			count += list.length;
		}
		return count;
	}

	public get fileCount(): number {
		return this.symbolsByFile.size;
	}

	/**
	 * Scans workspace files recursively and indexes symbols.
	 */
	public scanWorkspace(maxFiles = 500): void {
		if (!existsSync(this.workspaceRoot)) return;
		const files: string[] = [];

		const walk = (dir: string) => {
			if (files.length >= maxFiles) return;
			let entries: string[];
			try {
				entries = readdirSync(dir);
			} catch {
				return;
			}

			for (const entry of entries) {
				if (IGNORED_DIRS.has(entry) || entry.startsWith(".")) continue;
				const fullPath = join(dir, entry);
				try {
					const stat = statSync(fullPath);
					if (stat.isDirectory()) {
						walk(fullPath);
					} else if (stat.isFile() && SUPPORTED_EXTENSIONS.has(extname(fullPath).toLowerCase())) {
						files.push(fullPath);
					}
				} catch {
					// Ignore permission or transient fs errors
				}
			}
		};

		walk(this.workspaceRoot);

		for (const file of files) {
			try {
				const content = readFileSync(file, "utf8");
				const relPath = relative(this.workspaceRoot, file);
				const symbols = extractSymbolsFromSource(content, relPath);

				this.symbolsByFile.set(relPath, symbols);
				for (const sym of symbols) {
					const existing = this.symbolsByName.get(sym.name.toLowerCase()) || [];
					existing.push(sym);
					this.symbolsByName.set(sym.name.toLowerCase(), existing);
				}
			} catch {
				// Ignore unreadable files
			}
		}
	}

	/**
	 * Search for symbols matching query by prefix or fuzzy substring.
	 */
	public search(query: string, opts?: { kind?: SymbolKind; limit?: number }): CodeSymbol[] {
		const q = query.trim().toLowerCase();
		const limit = opts?.limit ?? 40;
		const results: CodeSymbol[] = [];

		for (const [nameKey, symbols] of this.symbolsByName.entries()) {
			if (results.length >= limit) break;
			if (!q || nameKey.includes(q)) {
				for (const sym of symbols) {
					if (opts?.kind && sym.kind !== opts.kind) continue;
					results.push(sym);
					if (results.length >= limit) break;
				}
			}
		}

		return results;
	}

	/**
	 * Finds references and call sites to a given symbol across indexed files.
	 */
	public findReferences(symbolName: string): SymbolReference[] {
		const refs: SymbolReference[] = [];
		const regex = new RegExp(`\\b${symbolName}\\b`);

		for (const [filePath] of this.symbolsByFile.entries()) {
			const fullPath = isAbsolute(filePath) ? filePath : join(this.workspaceRoot, filePath);
			try {
				if (!existsSync(fullPath)) continue;
				const content = readFileSync(fullPath, "utf8");
				const lines = content.split("\n");

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (regex.test(line)) {
						refs.push({
							filePath,
							line: i + 1,
							lineContent: line.trim().slice(0, 120),
						});
					}
				}
			} catch {
				// Ignore
			}
		}

		return refs;
	}

	public getSymbolsForFile(filePath: string): CodeSymbol[] {
		const rel = relative(this.workspaceRoot, filePath);
		return this.symbolsByFile.get(rel) || this.symbolsByFile.get(filePath) || [];
	}
}
