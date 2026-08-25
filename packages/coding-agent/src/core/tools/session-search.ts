/**
 * Session search tool (built-in): Qwen3 semantic retrieval over session
 * transcripts stored in the isolated Milvus session-message namespace.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { ensureLocalEmbeddingServer, localEmbeddingBaseUrl } from "../local-embedding-server.ts";
import {
	buildSessionMemoryIdentity,
	mapMilvusResults,
	type SessionMemoryDocument,
	SessionMilvusStore,
} from "../session-search-milvus.ts";

interface SessionDoc {
	file: string;
	id?: string;
	timestamp: string;
	role: string;
	text: string;
	milvusId?: string;
}

interface SessionSearchHit {
	doc: SessionDoc;
	score: number;
	context: string[];
	label?: string;
}

const MAX_FILES = 30;
const MAX_MESSAGES_PER_FILE = 400;
const milvus = new SessionMilvusStore();

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

function contextAround(docs: SessionDoc[], index: number, window = 2): string[] {
	const out: string[] = [];
	for (let i = Math.max(0, index - window); i <= Math.min(docs.length - 1, index + window); i++) {
		if (i === index) continue;
		const doc = docs[i];
		const snippet = doc.text.length > 220 ? `${doc.text.slice(0, 220)}…` : doc.text;
		out.push(`[${doc.role}] ${snippet}`);
	}
	return out;
}

async function embedQwen3(texts: string[]): Promise<number[][]> {
	const started = ensureLocalEmbeddingServer();
	if (!started || !(await started)) {
		throw new Error("Qwen3 embedding server is unavailable; configure the local embedding server and model first.");
	}
	const response = await fetch(`${localEmbeddingBaseUrl()}/embeddings`, {
		method: "POST",
		headers: { "content-type": "application/json", authorization: "Bearer local" },
		body: JSON.stringify({ model: process.env.OPENPI_EMBEDDING_MODEL ?? "qwen3-embedding", input: texts }),
	});
	if (!response.ok) throw new Error(`Qwen3 embedding request failed (${response.status}).`);
	const body = (await response.json()) as { data?: Array<{ index?: number; embedding?: unknown }> };
	if (!Array.isArray(body.data) || body.data.length !== texts.length) {
		throw new Error("Qwen3 embedding server returned an invalid response.");
	}
	const vectors = new Array<number[]>(texts.length);
	for (const item of body.data) {
		if (
			!Number.isInteger(item.index) ||
			!Array.isArray(item.embedding) ||
			item.embedding.some((v) => typeof v !== "number")
		) {
			throw new Error("Qwen3 embedding server returned an invalid vector.");
		}
		vectors[item.index!] = item.embedding;
	}
	if (vectors.some((vector) => !vector)) throw new Error("Qwen3 embedding server omitted a vector.");
	return vectors;
}

const SessionSearchParams = Type.Object({
	query: Type.String({ description: "Semantic search query over past session messages" }),
	limit: Type.Optional(
		Type.Integer({ default: 5, minimum: 1, maximum: 10, description: "Max hits to return (default 5)" }),
	),
});

function textResult(text: string): AgentToolResult<undefined> {
	return { content: [{ type: "text", text }], details: undefined };
}

function shortTimestamp(timestamp: string): string {
	if (!timestamp) return "";
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return timestamp;
	return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function createSessionSearchToolDefinition(): ToolDefinition<typeof SessionSearchParams, undefined> {
	return {
		name: "session_search",
		label: "Session Search",
		description:
			"Semantically search past session messages in this workspace with Qwen3 embeddings and Milvus. Use it to recall decisions, commands, or context from earlier sessions instead of asking the user or guessing.",
		promptSnippet: "session_search - recall past conversations with Qwen3/Milvus semantic retrieval",
		promptGuidelines: [
			"Before asking the user to repeat earlier context, try session_search to recall what was already discussed or done.",
		],
		parameters: SessionSearchParams,
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const sessionDir = ctx.sessionManager.getSessionDir();
			let files: string[];
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
			if (allDocs.length === 0) return textResult(`No past conversation matched "${params.query}".`);

			try {
				const vectors = await embedQwen3([...allDocs.map((doc) => doc.text), params.query]);
				const documents: SessionMemoryDocument[] = allDocs.map((doc, index) => {
					const identity = buildSessionMemoryIdentity({
						workspace: ctx.cwd,
						file: doc.file,
						messageId: doc.id,
						timestamp: doc.timestamp,
						role: doc.role,
						text: doc.text,
					});
					doc.milvusId = identity.id;
					return { ...identity, vector: vectors[index] };
				});
				await milvus.upsert(documents);
				const results = await milvus.search(
					documents[0].namespace,
					vectors.at(-1)!,
					Math.max(30, params.limit ?? 5),
				);
				const ranked = mapMilvusResults(
					results,
					allDocs.map((doc) => ({ ...doc, id: doc.milvusId!, sessionEntryId: doc.id })),
				);
				if (ranked.length === 0) return textResult(`No past conversation matched "${params.query}".`);

				const hits: SessionSearchHit[] = [];
				for (const { doc, score } of ranked.slice(0, params.limit ?? 5)) {
					const fileDocs = allDocs.filter((candidate) => candidate.file === doc.file);
					const index = fileDocs.findIndex((candidate) => candidate.milvusId === doc.milvusId);
					const label = doc.sessionEntryId ? labelsByFileTarget.get(doc.file)?.get(doc.sessionEntryId) : undefined;
					hits.push({ doc, score, context: index === -1 ? [] : contextAround(fileDocs, index), label });
				}
				const lines: string[] = [];
				for (const hit of hits) {
					const fileBase = hit.doc.file.split("/").pop() ?? hit.doc.file;
					const time = shortTimestamp(hit.doc.timestamp);
					lines.push(`### ${hit.label ?? fileBase}${time ? ` · ${time}` : ""} · score=${hit.score.toFixed(3)}`);
					lines.push(
						`[${hit.doc.role}] ${hit.doc.text.length > 500 ? `${hit.doc.text.slice(0, 500)}…` : hit.doc.text}`,
					);
					for (const context of hit.context) lines.push(context);
					lines.push("");
				}
				return textResult(lines.join("\n"));
			} catch (error) {
				return textResult(
					`(semantic session search unavailable: ${error instanceof Error ? error.message : String(error)})`,
				);
			}
		},
	};
}
