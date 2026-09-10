/**
 * Codebase AST Symbol Graph & References Tool
 *
 * Provides deep semantic symbol intelligence across TypeScript, JavaScript, Python, Go, and Rust:
 * - `code_symbol_search`: Search definitions of functions, classes, interfaces, types, structs
 * - `code_symbol_references`: Find all references, call sites, and usage impact of any symbol
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	WorkspaceSymbolIndexer,
	type SymbolKind,
} from "@openpi/shared";

const SymbolSearchParams = Type.Object({
	query: Type.String({ description: "Symbol name, prefix, or substring to search for" }),
	kind: Type.Optional(
		Type.String({
			description: "Filter by kind: function, class, interface, type, enum, struct, trait",
		}),
	),
	limit: Type.Optional(
		Type.Number({ description: "Maximum symbols to return (default: 30)", minimum: 1, maximum: 100 }),
	),
});

const SymbolReferencesParams = Type.Object({
	symbol: Type.String({ description: "Symbol name to find call sites and references for" }),
});

export default function registerSymbolTools(pi: ExtensionAPI): void {
	let indexerCache: WorkspaceSymbolIndexer | null = null;
	let lastIndexedAt = 0;

	const getIndexer = (cwd: string): WorkspaceSymbolIndexer => {
		const now = Date.now();
		// Re-index at most once every 30 seconds
		if (!indexerCache || now - lastIndexedAt > 30000) {
			indexerCache = new WorkspaceSymbolIndexer(cwd);
			indexerCache.scanWorkspace(1000);
			lastIndexedAt = now;
		}
		return indexerCache;
	};

	pi.registerTool({
		name: "code_symbol_search",
		label: "Code Symbol Search",
		description:
			"Search codebase symbols (functions, classes, interfaces, types, structs) with semantic kind and line numbers",
		parameters: SymbolSearchParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd || process.cwd();
			const indexer = getIndexer(cwd);
			const query = params.query;
			const kind = params.kind as SymbolKind | undefined;
			const limit = params.limit ?? 30;

			const matches = indexer.search(query, { kind, limit });

			if (matches.length === 0) {
				return {
					content: [{ type: "text", text: `No symbols found matching "${query}".` }],
					details: { count: 0, totalIndexed: indexer.symbolCount },
				};
			}

			const lines = matches.map(
				(sym) =>
					`• [${sym.kind}] ${sym.name} — ${sym.filePath}:${sym.line}\n  Signature: ${sym.signature || sym.name}`,
			);

			return {
				content: [
					{
						type: "text",
						text: `Found ${matches.length} symbol(s) matching "${query}":\n\n${lines.join("\n\n")}`,
					},
				],
				details: { count: matches.length, totalIndexed: indexer.symbolCount },
			};
		},
	});

	pi.registerTool({
		name: "code_symbol_references",
		label: "Code Symbol References",
		description:
			"Find all references, call sites, and usage locations of a symbol across the entire codebase to evaluate change impact",
		parameters: SymbolReferencesParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd || process.cwd();
			const indexer = getIndexer(cwd);
			const symbol = params.symbol.trim();

			const refs = indexer.findReferences(symbol);

			if (refs.length === 0) {
				return {
					content: [{ type: "text", text: `No references found for symbol "${symbol}".` }],
					details: { count: 0, symbol },
				};
			}

			const lines = refs.map((ref) => `• ${ref.filePath}:${ref.line}\n  ${ref.lineContent}`);

			return {
				content: [
					{
						type: "text",
						text: `Found ${refs.length} reference(s) to "${symbol}":\n\n${lines.join("\n")}`,
					},
				],
				details: { count: refs.length, symbol },
			};
		},
	});
}
