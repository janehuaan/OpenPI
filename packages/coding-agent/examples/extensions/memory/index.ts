/**
 * Memory Extension
 *
 * Implements a file-based memory system for persistent cross-session knowledge.
 * Inspired by Claude Code's memdir architecture.
 *
 * Design principles:
 * - Memory is persisted as plain text files on disk — inspectable, version-controllable
 * - Index file (.pi/memory/MEMORY.md) with 200-line cap
 * - Four memory types: user, feedback, project, lesson
 * - Frozen snapshot: index loaded at session start
 * - Pre-compaction flush: before compaction, LLM gets one turn to save
 * - Exclusion list: info derivable from git/codebase should NOT be stored
 * - No vector DB, no embeddings, no external dependencies
 *
 * How it works:
 * - The extension provides `memory_index` tool to manage the index file
 * - The extension provides `memory_list` tool to enumerate stored memories
 * - The LLM uses built-in `write`/`read` tools to manage topic files directly
 * - On session_start, the index is loaded and announced to the model
 * - On session_before_compact, the index is injected into compaction prep
 *
 * Memory location: .pi/memory/
 * Index file: .pi/memory/MEMORY.md
 * Topic files: .pi/memory/{type}-{key}.md
 *
 * Usage:
 *   pi --extension examples/extensions/memory/index.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// Constants
// ============================================================================

const MEMORY_DIR = ".pi/memory";
const INDEX_FILE = "MEMORY.md";
const MAX_INDEX_ENTRIES = 200;

const MEMORY_TYPES = ["user", "feedback", "project", "lesson"] as const;
type MemoryType = (typeof MEMORY_TYPES)[number];

// ============================================================================
// Types
// ============================================================================

interface MemoryIndexEntry {
	type: MemoryType;
	key: string;
	value: string; // short summary for index
}

// ============================================================================
// Helpers
// ============================================================================

function sanitizeKey(key: string): string {
	return key
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "-")
		.slice(0, 64);
}

function sanitizeType(type: string): MemoryType {
	if ((MEMORY_TYPES as readonly string[]).includes(type)) return type as MemoryType;
	return "project";
}

function topicFileName(type: MemoryType, key: string): string {
	return `${type}-${sanitizeKey(key)}.md`;
}

// ============================================================================
// Index management
// ============================================================================

function parseIndex(content: string): MemoryIndexEntry[] {
	const lines = content.split("\n");
	const entries: MemoryIndexEntry[] = [];
	let currentType: MemoryType | null = null;

	for (const line of lines) {
		const headingMatch = line.match(/^##\s+(user|feedback|project|lesson)$/i);
		if (headingMatch) {
			currentType = headingMatch[1] as MemoryType;
			continue;
		}
		if (!currentType) continue;

		const entryMatch = line.match(/^\s*-\s*\[([^\]]+)\]\s*(.+)$/);
		if (entryMatch) {
			entries.push({
				type: currentType,
				key: entryMatch[1],
				value: entryMatch[2].trim(),
			});
		}
	}

	return entries;
}

function generateIndexContent(entries: MemoryIndexEntry[]): string {
	const byType: Record<MemoryType, MemoryIndexEntry[]> = {
		user: [],
		feedback: [],
		project: [],
		lesson: [],
	};

	for (const entry of entries) {
		byType[entry.type].push(entry);
	}

	const parts: string[] = [];
	for (const type of MEMORY_TYPES) {
		const typeEntries = byType[type];
		if (typeEntries.length === 0) continue;
		parts.push(`## ${type}`);
		for (const entry of typeEntries) {
			const escaped = entry.value.replace(/\n/g, " ").slice(0, 100);
			parts.push(`- [${entry.key}] ${escaped}`);
		}
		parts.push("");
	}

	return `${parts.join("\n").trim()}\n`;
}

function updateIndex(
	entries: MemoryIndexEntry[],
	type: MemoryType,
	key: string,
	value: string | null,
): MemoryIndexEntry[] {
	if (value === null) {
		return entries.filter((e) => !(e.type === type && e.key === key));
	}
	const idx = entries.findIndex((e) => e.type === type && e.key === key);
	const newEntry: MemoryIndexEntry = { type, key, value };
	if (idx >= 0) {
		entries[idx] = newEntry;
	} else {
		entries.push(newEntry);
	}
	return entries;
}

// ============================================================================
// Tool Definitions
// ============================================================================

const MemoryIndexParams = Type.Object({
	action: Type.Optional(Type.String({ description: "Action: 'add', 'remove', or 'read'. Default: read." })),
	type: Type.Optional(Type.String({ description: "Memory type: user, feedback, project, lesson." })),
	key: Type.Optional(Type.String({ description: "Memory key (unique identifier)." })),
	value: Type.Optional(Type.String({ description: "Short summary for index (used when action=add)." })),
});

const MemoryListParams = Type.Object({
	type: Type.Optional(Type.String({ description: "Filter by type. Omit for all." })),
});

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	const exclusionList = [
		"Code patterns derivable from git/codebase",
		"In-progress task state",
		"Debugging recipes specific to one session",
		"Conversation-bound details",
		"File structure (use grep/find instead)",
	];

	// --- memory_index: manage the MEMORY.md index ---
	pi.registerTool({
		name: "memory_index",
		label: "Memory Index",
		description: `Manage the MEMORY.md index file in .pi/memory/.

Three actions:
- read: display the current index
- add: add an entry (requires type, key, value)
- remove: remove an entry (requires type, key)

The index is a pointer file — actual memory content lives in topic files
(.pi/memory/{type}-{key}.md) managed by the LLM via the write/read tools.

Format:
## type
- [key] short summary

Capacity: ${MAX_INDEX_ENTRIES} entries max.

Exclusion list: ${exclusionList.join(", ")}`,
		promptSnippet: "Use memory_index to manage the memory index file",
		promptGuidelines: [
			"Read the index first with action='read' to see all memories.",
			"After creating a topic file, add an index entry with action='add'.",
			"After deleting a topic file, remove the index entry with action='remove'.",
			"Do not save anything derivable from git/codebase.",
		],
		parameters: MemoryIndexParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const indexFullPath = `${cwd}/${MEMORY_DIR}/${INDEX_FILE}`;
			const action = params.action ?? "read";
			const type = params.type ? sanitizeType(params.type) : "project";
			const key = params.key ? sanitizeKey(params.key) : "";
			const value = params.value;

			if (action === "read") {
				try {
					const { stdout, code } = await pi.exec("cat", [indexFullPath]);
					if (code !== 0 || !stdout.trim()) {
						return {
							content: [{ type: "text", text: "No index file found. Create one with 'add' action." }],
							details: { action: "read", empty: true, count: 0 },
						};
					}
					return {
						content: [{ type: "text", text: stdout }],
						details: { action: "read", count: parseIndex(stdout).length },
					};
				} catch {
					return {
						content: [{ type: "text", text: "No index file found." }],
						details: { action: "read", empty: true, count: 0 },
					};
				}
			}

			if (action === "add") {
				if (!key || !value) {
					return {
						content: [{ type: "text", text: "Error: 'key' and 'value' required for add action." }],
						details: { action: "add", error: "missing params" },
					};
				}

				let entries: MemoryIndexEntry[] = [];
				try {
					const { stdout, code } = await pi.exec("cat", [indexFullPath]);
					if (code === 0 && stdout.trim()) {
						entries = parseIndex(stdout);
					}
				} catch {
					// No existing index
				}

				entries = updateIndex(entries, type, key, value);

				// Cap at MAX_INDEX_ENTRIES
				if (entries.length > MAX_INDEX_ENTRIES) {
					entries = entries.slice(0, MAX_INDEX_ENTRIES);
				}

				const newIndex = generateIndexContent(entries);

				// Use shell to write the file
				const writeCmd = `mkdir -p ${cwd}/${MEMORY_DIR} && printf '%s' '${newIndex.replace(/'/g, "'\\''")}' > ${indexFullPath}`;
				const { code, stderr } = await pi.exec("bash", ["-c", writeCmd]);

				if (code !== 0) {
					return {
						content: [{ type: "text", text: `Error updating index: ${stderr}` }],
						details: { action: "add", error: stderr },
					};
				}

				return {
					content: [{ type: "text", text: `Index updated: ${entries.length} entries.` }],
					details: { action: "add", type, key, entryCount: entries.length },
				};
			}

			if (action === "remove") {
				if (!key) {
					return {
						content: [{ type: "text", text: "Error: 'key' required for remove action." }],
						details: { action: "remove", error: "missing key" },
					};
				}

				let entries: MemoryIndexEntry[] = [];
				try {
					const { stdout, code } = await pi.exec("cat", [indexFullPath]);
					if (code === 0 && stdout.trim()) {
						entries = parseIndex(stdout);
					}
				} catch {
					// No existing index
				}

				entries = updateIndex(entries, type, key, null);

				const newIndex = generateIndexContent(entries);

				const writeCmd = `printf '%s' '${newIndex.replace(/'/g, "'\\''")}' > ${indexFullPath}`;
				await pi.exec("bash", ["-c", writeCmd]);

				return {
					content: [{ type: "text", text: `Removed ${type}/${key} from index.` }],
					details: { action: "remove", type, key, entryCount: entries.length },
				};
			}

			return {
				content: [{ type: "text", text: `Unknown action: ${action}. Use 'read', 'add', or 'remove'.` }],
				details: { action: "invalid" },
			};
		},
	});

	// --- memory_list: list all memories ---
	pi.registerTool({
		name: "memory_list",
		label: "Memory List",
		description: "List all memory entries, optionally filtered by type.",
		promptSnippet: "Use memory_list to see all stored memories",
		parameters: MemoryListParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;
			const indexFullPath = `${cwd}/${MEMORY_DIR}/${INDEX_FILE}`;

			try {
				const { stdout, code } = await pi.exec("cat", [indexFullPath]);
				if (code !== 0 || !stdout.trim()) {
					return {
						content: [{ type: "text", text: "No memories found." }],
						details: { count: 0 },
					};
				}

				const entries = parseIndex(stdout);
				const typeFilter = params.type ? sanitizeType(params.type) : null;
				const filtered = typeFilter ? entries.filter((e) => e.type === typeFilter) : entries;

				if (filtered.length === 0) {
					return {
						content: [{ type: "text", text: "No memories found." }],
						details: { count: 0 },
					};
				}

				const lines = filtered.map((e) => {
					const fileName = topicFileName(e.type, e.key);
					return `[${e.type}] ${e.key}: ${fileName}`;
				});

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: { count: filtered.length, filtered: !!typeFilter },
				};
			} catch {
				return {
					content: [{ type: "text", text: "No memories found." }],
					details: { count: 0 },
				};
			}
		},
	});

	// (Compaction integration requires ExtensionContext to have sendMessage/appendEntry,
	// which it doesn't. This is left as a future enhancement.)// --- session_start hook: announce available memories ---
	// Load the index at session start so the model knows what memories exist.
	// This is the "frozen snapshot" pattern — the index is loaded once and
	// stays in context for the session.
	// Note: ExtensionContext doesn't have sendMessage/appendEntry, so we use
	// ui.notify instead for user visibility.
	pi.on("session_start", async (_event, ctx) => {
		const cwd = ctx.cwd;
		const indexFullPath = `${cwd}/${MEMORY_DIR}/${INDEX_FILE}`;

		try {
			const { stdout, code } = await pi.exec("cat", [indexFullPath]);
			if (code !== 0 || !stdout.trim()) return;

			const entries = parseIndex(stdout);
			if (entries.length === 0) return;

			// Notify user that memories are available
			if (ctx.hasUI) {
				ctx.ui.notify(`Memory: ${entries.length} entries loaded from .pi/memory/MEMORY.md`, "info");
			}
		} catch {
			// Index file doesn't exist yet
		}
	});
}
