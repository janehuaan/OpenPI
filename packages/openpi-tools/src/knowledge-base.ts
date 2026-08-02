/**
 * Knowledge Base Extension
 *
 * Provides local RAG (Retrieval-Augmented Generation) for markdown, text,
 * and HTML documents. No vector DB needed — uses token-aware chunking and
 * keyword-based retrieval.
 *
 * Usage:
 *   pi --extension examples/extensions/knowledge-base.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// Types
// ============================================================================

interface KBEntry {
	id: string;
	source: string; // relative file path
	chunk: string;
	chars: number;
	tokens: number;
	added: string;
}

interface KBIndex {
	version: number;
	entries: KBEntry[];
	lastScanned: string;
}

const KB_DIR = ".pi/knowledge-base";
const KB_INDEX_FILE = `${KB_DIR}/index.json`;
const _KB_CACHE_DIR = `${KB_DIR}/chunks`;
const CHUNK_SIZE = 1500; // characters per chunk
const OVERLAP = 200; // overlap between chunks

// ============================================================================
// Helpers
// ============================================================================

function generateId(): string {
	return `kb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4); // rough estimate: 4 chars per token
}

function chunkText(text: string, source: string): KBEntry[] {
	const entries: KBEntry[] = [];
	let start = 0;

	while (start < text.length) {
		const end = Math.min(start + CHUNK_SIZE, text.length);
		// Try to break at sentence boundary
		let breakPoint = end;
		for (let i = end - 1; i > Math.max(end - 200, start); i--) {
			if (text[i] === "." || text[i] === "\n" || text[i] === "\r") {
				breakPoint = i + 1;
				break;
			}
		}

		const chunk = text.slice(start, breakPoint).trim();
		if (chunk.length > 50) {
			entries.push({
				id: generateId(),
				source,
				chunk,
				chars: chunk.length,
				tokens: estimateTokens(chunk),
				added: new Date().toISOString(),
			});
		}

		// Advance start. Guard against non-progress (breakPoint - OVERLAP could
		// be <= start for short chunks), which would otherwise loop forever.
		const nextStart = breakPoint - OVERLAP;
		start = nextStart > start ? nextStart : breakPoint;
		if (breakPoint >= text.length) break;
	}

	return entries;
}

function loadIndex(cwd: string): KBIndex {
	try {
		const filePath = path.join(cwd, KB_INDEX_FILE);
		if (!fs.existsSync(filePath)) {
			return { version: 1, entries: [], lastScanned: new Date().toISOString() };
		}
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return { version: 1, entries: [], lastScanned: new Date().toISOString() };
	}
}

function saveIndex(cwd: string, index: KBIndex): void {
	try {
		const dir = path.join(cwd, KB_DIR);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		const filePath = path.join(cwd, KB_INDEX_FILE);
		fs.writeFileSync(filePath, JSON.stringify(index, null, 2), "utf-8");
	} catch {
		// Silently fail
	}
}

function findDocuments(cwd: string): string[] {
	try {
		const extensions = [".md", ".txt", ".html", ".htm", ".rst"];
		const dirsToSkip = ["node_modules", ".git", "dist", "build", ".pi", "coverage"];
		const results: string[] = [];

		function scan(dir: string) {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					if (!dirsToSkip.includes(entry.name)) scan(fullPath);
				} else if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
					results.push(fullPath);
				}
			}
		}

		scan(cwd);
		return results;
	} catch {
		return [];
	}
}

// ============================================================================
// Tools
// ============================================================================

const KBScanParams = Type.Object({
	path: Type.Optional(Type.String({ description: "File or directory to scan. Default: project root." })),
});

const KBQueryParams = Type.Object({
	query: Type.String({ description: "Search query." }),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Max results. Default: 10." })),
});

const KBAddParams = Type.Object({
	path: Type.String({ description: "File path to add to knowledge base." }),
});

const KBRemoveParams = Type.Object({
	id: Type.Optional(Type.String({ description: "Entry ID to remove." })),
	source: Type.Optional(Type.String({ description: "Remove all entries from this source file." })),
});

const KBListParams = Type.Object({
	source: Type.Optional(Type.String({ description: "Filter by source file." })),
});

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	// --- kb_scan ---
	pi.registerTool({
		name: "kb_scan",
		label: "KB Scan",
		description: "Scan project for documents and build the knowledge base index.",
		promptSnippet: "Use kb_scan to index all project documents for retrieval",
		promptGuidelines: [
			"Scan before querying to ensure the index is up to date.",
			"Supports .md, .txt, .html, .rst files.",
		],
		parameters: KBScanParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const targetPath = params.path ?? ctx.cwd;

			// Read file or list directory
			const resolvedPath = path.isAbsolute(targetPath) ? targetPath : path.join(ctx.cwd, targetPath);

			let files: string[];
			if (fs.statSync(resolvedPath).isDirectory()) {
				files = findDocuments(resolvedPath);
			} else {
				files = [resolvedPath];
			}

			if (files.length === 0) {
				return { content: [{ type: "text", text: "No documents found." }], details: { scanned: 0 } };
			}

			const index = loadIndex(ctx.cwd);
			let totalChunks = 0;

			for (const file of files) {
				const relPath = file.replace(`${ctx.cwd}/`, "");
				try {
					const content = fs.readFileSync(file, "utf-8");
					const entries = chunkText(content, relPath);
					totalChunks += entries.length;

					// Remove old entries for this source
					index.entries = index.entries.filter((e) => e.source !== relPath);
					index.entries.push(...entries);
				} catch {
					// Skip unreadable files
				}
			}

			index.lastScanned = new Date().toISOString();
			saveIndex(ctx.cwd, index);

			return {
				content: [{ type: "text", text: `Indexed ${files.length} files, ${totalChunks} chunks.` }],
				details: { scanned: files.length, chunks: totalChunks, totalEntries: index.entries.length },
			};
		},
	});

	// --- kb_query ---
	pi.registerTool({
		name: "kb_query",
		label: "KB Query",
		description: "Search the knowledge base using keyword matching (no embeddings needed).",
		promptSnippet: "Use kb_query to retrieve relevant document chunks",
		promptGuidelines: [
			"Query after scanning to find relevant information.",
			"Uses keyword matching — works well for technical documentation.",
		],
		parameters: KBQueryParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const index = loadIndex(ctx.cwd);
			const query = params.query.toLowerCase();
			const limit = params.limit ?? 10;

			// Keyword scoring
			const scored = index.entries
				.map((entry) => {
					const text = entry.chunk.toLowerCase();
					const words = query.split(/\s+/).filter(Boolean);
					let score = 0;
					for (const word of words) {
						if (text.includes(word)) score++;
					}
					return { entry, score };
				})
				.filter((s) => s.score > 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, limit);

			if (scored.length === 0) {
				return { content: [{ type: "text", text: "No matching documents found." }], details: { count: 0 } };
			}

			const results = scored.map((s) => {
				const preview = s.entry.chunk.slice(0, 200);
				return `[${s.entry.source}] (score: ${s.score}, tokens: ${s.entry.tokens})\n${preview}${s.entry.chunk.length > 200 ? "..." : ""}`;
			});

			return {
				content: [{ type: "text", text: results.join("\n\n") }],
				details: { count: scored.length, totalEntries: index.entries.length },
			};
		},
	});

	// --- kb_add ---
	pi.registerTool({
		name: "kb_add",
		label: "KB Add",
		description: "Add a single file to the knowledge base.",
		promptSnippet: "Use kb_add to add a specific file to the knowledge base",
		parameters: KBAddParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const resolvedPath = path.isAbsolute(params.path) ? params.path : path.join(ctx.cwd, params.path);

			if (!fs.existsSync(resolvedPath)) {
				return {
					content: [{ type: "text", text: `File not found: ${params.path}` }],
					details: { error: "not-found" },
				};
			}

			const content = fs.readFileSync(resolvedPath, "utf-8");
			const relPath = resolvedPath.replace(`${ctx.cwd}/`, "");
			const entries = chunkText(content, relPath);

			const index = loadIndex(ctx.cwd);
			index.entries = index.entries.filter((e) => e.source !== relPath);
			index.entries.push(...entries);
			saveIndex(ctx.cwd, index);

			return {
				content: [{ type: "text", text: `Added ${entries.length} chunks from ${relPath}` }],
				details: { source: relPath, chunks: entries.length },
			};
		},
	});

	// --- kb_remove ---
	pi.registerTool({
		name: "kb_remove",
		label: "KB Remove",
		description: "Remove entries from the knowledge base.",
		promptSnippet: "Use kb_remove to delete entries",
		parameters: KBRemoveParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const index = loadIndex(ctx.cwd);

			if (params.id) {
				index.entries = index.entries.filter((e) => e.id !== params.id);
			} else if (params.source) {
				const count = index.entries.filter((e) => e.source === params.source).length;
				index.entries = index.entries.filter((e) => e.source !== params.source);
				return {
					content: [{ type: "text", text: `Removed ${count} entries from ${params.source}` }],
					details: { removed: count },
				};
			}

			saveIndex(ctx.cwd, index);
			return {
				content: [{ type: "text", text: `Removed entry: ${params.id}` }],
				details: { removed: 1 },
			};
		},
	});

	// --- kb_list ---
	pi.registerTool({
		name: "kb_list",
		label: "KB List",
		description: "List all indexed documents.",
		promptSnippet: "Use kb_list to see indexed documents",
		parameters: KBListParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const index = loadIndex(ctx.cwd);
			const filtered = params.source ? index.entries.filter((e) => e.source === params.source) : index.entries;

			if (filtered.length === 0) {
				return { content: [{ type: "text", text: "No indexed documents." }], details: { count: 0 } };
			}

			// Group by source
			const bySource: Record<string, number> = {};
			for (const entry of filtered) {
				bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
			}

			const lines = Object.entries(bySource).map(([source, count]) => `${source}: ${count} chunks`);
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { count: filtered.length, sources: Object.keys(bySource).length },
			};
		},
	});
}
