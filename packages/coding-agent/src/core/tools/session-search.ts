/**
 * Session search tool (built-in): BM25 retrieval over historical session
 * transcripts so the agent can recall what was discussed/done in earlier
 * conversations in this workspace.
 *
 * Scans the most recently modified session files under the session dir,
 * indexes message-level documents, and returns the top hits with a few
 * surrounding messages for context.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import {
	type EmbedBatchFn,
	localEmbedBatch,
	searchVectorStore,
	upsertVectorStore,
	type VectorStoreDoc,
} from "../vector-store.ts";
import { embeddingCachePath, embedTexts, loadEmbeddingConfig } from "./embedding.ts";

interface SessionDoc {
	file: string;
	id?: string;
	timestamp: string;
	role: string;
	text: string;
}

interface SessionSearchHit {
	doc: SessionDoc;
	score: number;
	context: string[];
	label?: string;
}

const MAX_FILES = 30;
const MAX_MESSAGES_PER_FILE = 400;

function tokenize(text: string): string[] {
	return text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function extractText(message: unknown): string {
	if (typeof message === "string") return message;
	if (typeof message !== "object" || message === null) return "";
	const record = message as Record<string, unknown>;
	const content = record.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") return part;
				if (typeof part === "object" && part !== null) {
					const block = part as Record<string, unknown>;
					if (block.type === "text" && typeof block.text === "string") return block.text;
					if (block.type === "toolResult" && typeof block.text === "string") return block.text;
				}
				return "";
			})
			.join("\n");
	}
	return "";
}

function scanSessionFile(file: string): { docs: SessionDoc[]; labels: Map<string, string> } {
	const docs: SessionDoc[] = [];
	const labels = new Map<string, string>();
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return { docs, labels };
	}
	const lines = raw.split("\n").filter((line) => line.trim().length > 0);
	const start = Math.max(0, lines.length - MAX_MESSAGES_PER_FILE);
	for (const line of lines.slice(start)) {
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (entry.type === "label") {
			if (typeof entry.targetId === "string" && typeof entry.label === "string") {
				labels.set(entry.targetId, entry.label);
			}
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message as Record<string, unknown> | undefined;
		if (!message || typeof message !== "object") continue;
		const role = typeof message.role === "string" ? message.role : "message";
		const text = extractText(message).trim();
		if (text.length === 0) continue;
		const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
		const id = typeof entry.id === "string" ? entry.id : undefined;
		docs.push({ file, id, timestamp, role, text: text.slice(0, 4000) });
	}
	return { docs, labels };
}

/** BM25 scoring: k1 = 1.5, b = 0.75. */
function scoreDocs(queryTokens: string[], docs: SessionDoc[]): Array<{ doc: SessionDoc; score: number }> {
	if (docs.length === 0 || queryTokens.length === 0) return [];
	const n = docs.length;
	const avgdl = docs.reduce((sum, doc) => sum + tokenize(doc.text).length, 0) / n;
	const docTokenCounts = docs.map((doc) => tokenize(doc.text));
	const df = new Map<string, number>();
	for (const tokens of docTokenCounts) {
		for (const token of new Set(tokens)) {
			df.set(token, (df.get(token) ?? 0) + 1);
		}
	}
	const results: Array<{ doc: SessionDoc; score: number }> = [];
	for (let i = 0; i < docs.length; i++) {
		const tokens = docTokenCounts[i];
		if (tokens.length === 0) continue;
		const tf = new Map<string, number>();
		for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
		let score = 0;
		for (const token of queryTokens) {
			const termFreq = tf.get(token);
			if (termFreq === undefined || termFreq === 0) continue;
			const docFreq = df.get(token) ?? 0;
			const idf = Math.log(1 + (n - docFreq + 0.5) / (docFreq + 0.5));
			const numerator = termFreq * (1.5 + 1);
			const denominator = termFreq + 1.5 * (1 - 0.75 + 0.75 * (tokens.length / avgdl));
			score += idf * (numerator / denominator);
		}
		if (score > 0) results.push({ doc: docs[i], score });
	}
	return results.sort((a, b) => b.score - a.score);
}

function contextAround(docs: SessionDoc[], index: number, window = 2): string[] {
	const out: string[] = [];
	for (let i = Math.max(0, index - window); i <= Math.min(docs.length - 1, index + window); i++) {
		const doc = docs[i];
		if (i === index) continue;
		const snippet = doc.text.length > 220 ? `${doc.text.slice(0, 220)}…` : doc.text;
		out.push(`[${doc.role}] ${snippet}`);
	}
	return out;
}

const SessionSearchParams = Type.Object({
	query: Type.String({ description: "Search query; tokens are matched with BM25 over past messages" }),
	limit: Type.Optional(
		Type.Integer({ default: 5, minimum: 1, maximum: 10, description: "Max hits to return (default 5)" }),
	),
	rerank: Type.Optional(
		Type.Union([Type.Literal("auto"), Type.Literal("on"), Type.Literal("off")], {
			description:
				"Semantic reranking: auto (default) uses embeddings when OPENPI_EMBEDDING_API_KEY is set, on forces it, off disables it",
		}),
	),
});

function textResult(text: string): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}

function shortTimestamp(timestamp: string): string {
	if (!timestamp) return "";
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return timestamp;
	return date.toLocaleString("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

interface MemoryEntry {
	type: string;
	key: string;
	value: string;
}

function parseMemoryIndex(content: string): MemoryEntry[] {
	const entries: MemoryEntry[] = [];
	let currentType: string | null = null;
	for (const line of content.split("\n")) {
		const heading = line.match(/^##\s+(user|feedback|project|lesson)$/i);
		if (heading) {
			currentType = heading[1].toLowerCase();
			continue;
		}
		if (!currentType) continue;
		const match = line.match(/^\s*-\s*\[([^\]]+)\]\s*(.+)$/);
		if (match) entries.push({ type: currentType, key: match[1], value: match[2].trim() });
	}
	return entries;
}

/** Memory index entries (project + user-global) as searchable docs. */
function loadMemoryDocs(cwd: string): SessionDoc[] {
	const paths = [join(cwd, ".pi", "memory", "MEMORY.md"), join(homedir(), ".pi", "memory", "MEMORY.md")];
	const docs: SessionDoc[] = [];
	for (const file of paths) {
		try {
			const entries = parseMemoryIndex(readFileSync(file, "utf8"));
			for (const entry of entries) {
				docs.push({
					id: `memory:${entry.type}:${entry.key}`,
					file: `memory:${entry.type}`,
					timestamp: "",
					role: "memory",
					text: `[${entry.key}] ${entry.value}`,
				});
			}
		} catch {
			// Index absent or unreadable — skip this source.
		}
	}
	return docs;
}

export function createSessionSearchToolDefinition(): ToolDefinition<typeof SessionSearchParams, undefined> {
	return {
		name: "session_search",
		label: "Session Search",
		description:
			"Search past conversations in this workspace (BM25 over session transcripts). Use to recall decisions, commands, or context from earlier sessions instead of asking the user or guessing.",
		promptSnippet: "session_search - recall past conversations with BM25",
		promptGuidelines: [
			"Before asking the user to repeat earlier context, try session_search to recall what was already discussed or done.",
		],
		parameters: SessionSearchParams,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const sessionDir = ctx.sessionManager.getSessionDir();
			let files: string[] = [];
			try {
				files = readdirSync(sessionDir)
					.filter((name) => name.endsWith(".jsonl"))
					.map((name) => join(sessionDir, name))
					.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
					.slice(0, MAX_FILES);
			} catch {
				return textResult("(session directory unavailable)");
			}

			const allDocs: SessionDoc[] = [];
			const labelsByFileTarget = new Map<string, Map<string, string>>();
			for (const file of files) {
				const { docs, labels } = scanSessionFile(file);
				labelsByFileTarget.set(file, labels);
				allDocs.push(...docs);
			}
			allDocs.push(...loadMemoryDocs(ctx.cwd));

			const queryTokens = tokenize(params.query);
			if (queryTokens.length === 0) {
				return textResult("(empty query; provide at least one search term)");
			}
			const scored = scoreDocs(queryTokens, allDocs);
			if (scored.length === 0) {
				return textResult(`No past conversation matched "${params.query}".`);
			}

			// Vector-library path (default): persist + incrementally update the
			// local vector store over all memory/session docs, search the whole
			// store by cosine, and blend with normalized BM25 for word-exact
			// recall. `rerank: off` keeps the pure BM25 path.
			let ranked: Array<{ doc: SessionDoc; score: number }> = scored.slice(0, 30);
			const useSemantic = params.rerank === "on" || params.rerank !== "off";
			if (useSemantic) {
				const vectorDocs: VectorStoreDoc[] = allDocs.map((doc) => ({
					id: doc.id ?? `${doc.file}:${doc.timestamp}:${doc.role}`,
					source: doc.file,
					role: doc.role,
					text: doc.text,
					timestamp: doc.timestamp || undefined,
				}));
				// Embedder: real embeddings (remote API or local llama-server)
				// when configured, otherwise the zero-dependency hash embedder.
				const embeddingConfig = loadEmbeddingConfig();
				let embed: EmbedBatchFn = localEmbedBatch;
				if (embeddingConfig) {
					embed = async (texts) => {
						const vectors = await embedTexts(texts, embeddingConfig, embeddingCachePath(ctx.cwd));
						return vectors ?? [];
					};
				}
				await upsertVectorStore(ctx.cwd, vectorDocs, embed);
				const vectorHits = await searchVectorStore(ctx.cwd, params.query, 30, embed);
				if (vectorHits.length > 0) {
					const maxBm25 = Math.max(...scored.map((entry) => entry.score), 1e-9);
					const bm25ByText = new Map<string, number>();
					for (const entry of scored) bm25ByText.set(entry.doc.text, entry.score / maxBm25);
					ranked = vectorHits.map((hit) => ({
						doc: {
							id: hit.id,
							file: hit.source,
							timestamp: hit.timestamp ?? "",
							role: hit.role,
							text: hit.text,
						},
						score: 0.7 * hit.score + 0.3 * (bm25ByText.get(hit.text) ?? 0),
					}));
				}
			}

			const hits: SessionSearchHit[] = [];
			for (const { doc, score } of ranked.slice(0, params.limit ?? 5)) {
				// Find the doc's position within its own file for context.
				const fileDocs = allDocs.filter((candidate) => candidate.file === doc.file);
				const index = fileDocs.findIndex(
					(candidate) =>
						candidate === doc ||
						(candidate.timestamp === doc.timestamp && candidate.role === doc.role && candidate.text === doc.text),
				);
				const label = doc.id ? labelsByFileTarget.get(doc.file)?.get(doc.id) : undefined;
				hits.push({
					doc,
					score,
					context: index === -1 ? [] : contextAround(fileDocs, index),
					label,
				});
			}

			const lines: string[] = [];
			for (const hit of hits) {
				const fileBase = hit.doc.file.startsWith("memory:")
					? hit.doc.file
					: (hit.doc.file.split("/").pop() ?? hit.doc.file);
				const time = shortTimestamp(hit.doc.timestamp);
				lines.push(`### ${hit.label ?? fileBase}${time ? ` · ${time}` : ""} · score=${hit.score.toFixed(1)}`);
				const snippet = hit.doc.text.length > 500 ? `${hit.doc.text.slice(0, 500)}…` : hit.doc.text;
				lines.push(`[${hit.doc.role}] ${snippet}`);
				for (const context of hit.context) lines.push(context);
				lines.push("");
			}
			return textResult(lines.join("\n"));
		},
	};
}
