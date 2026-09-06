/**
 * Session search tool: CJK-aware BM25 retrieval over historical session transcripts.
 * Allows the agent to recall decisions, commands, code, or context discussed in earlier
 * conversations across workspaces and historical sessions.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { rankBm25 } from "./rank.ts";

export interface SessionDoc {
	id: string;
	file: string;
	sessionTitle?: string;
	timestamp: string;
	role: string;
	text: string;
}

export interface SessionSearchHit {
	doc: SessionDoc;
	score: number;
	context: string[];
}

const MAX_FILES = 40;
const MAX_MESSAGES_PER_FILE = 400;

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

export function scanSessionFile(file: string): { docs: SessionDoc[]; title?: string } {
	const docs: SessionDoc[] = [];
	let title: string | undefined;
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return { docs, title };
	}
	const lines = raw.split("\n").filter((line) => line.trim().length > 0);
	const start = Math.max(0, lines.length - MAX_MESSAGES_PER_FILE);
	let messageIndex = 0;
	for (const line of lines.slice(start)) {
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (entry.type === "session_info" && typeof entry.name === "string") {
			title = entry.name;
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message as Record<string, unknown> | undefined;
		if (!message || typeof message !== "object") continue;
		const role = typeof message.role === "string" ? message.role : "message";
		const text = extractText(message).trim();
		if (text.length === 0) continue;
		const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : "";
		const id = `${basename(file)}#${messageIndex++}`;
		docs.push({
			id,
			file,
			sessionTitle: title,
			timestamp,
			role,
			text: text.slice(0, 4000),
		});
	}
	if (title) {
		for (const doc of docs) {
			doc.sessionTitle = title;
		}
	}
	return { docs, title };
}

function contextAround(docs: SessionDoc[], index: number, window = 2): string[] {
	const out: string[] = [];
	for (let i = Math.max(0, index - window); i <= Math.min(docs.length - 1, index + window); i++) {
		if (i === index) continue;
		const doc = docs[i];
		const snippet = doc.text.length > 200 ? `${doc.text.slice(0, 200)}…` : doc.text;
		out.push(`[${doc.role}] ${snippet}`);
	}
	return out;
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

export function candidateSessionDirs(cwd?: string): string[] {
	const dirs: string[] = [
		join(homedir(), ".openpi", "sessions"),
		join(homedir(), ".pi", "agent", "sessions"),
	];
	if (cwd) {
		dirs.push(join(cwd, ".pi", "sessions"));
		dirs.push(join(cwd, ".openpi", "sessions"));
	}
	return dirs.filter((dir) => existsSync(dir));
}

export const SessionSearchParams = Type.Object({
	query: Type.String({
		description: "Search query; matched using CJK-aware BM25 over historical session transcripts.",
	}),
	limit: Type.Optional(
		Type.Integer({
			default: 5,
			minimum: 1,
			maximum: 15,
			description: "Max results to return (default 5).",
		}),
	),
});

export function registerSessionSearchTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "session_search",
		label: "Session Search",
		description:
			"Search past conversations and historical sessions across workspaces (BM25 over past transcripts). Use this to recall past decisions, architectural choices, debugging solutions, or commands from earlier sessions instead of asking the user to repeat them.",
		promptSnippet: "session_search - recall past conversations and historical sessions with BM25",
		promptGuidelines: [
			"Prior conversations across all sessions are indexed — use session_search before asking the user to repeat historical context or past discussions.",
		],
		parameters: SessionSearchParams,
		async execute(_id, params, _signal, _update, ctx) {
			const searchDirs = candidateSessionDirs(ctx.cwd);
			const sessionFiles: Array<{ path: string; mtimeMs: number }> = [];

			for (const dir of searchDirs) {
				try {
					const entries = readdirSync(dir).filter((n) => n.endsWith(".jsonl"));
					for (const name of entries) {
						const fullPath = join(dir, name);
						try {
							const st = statSync(fullPath);
							sessionFiles.push({ path: fullPath, mtimeMs: st.mtimeMs });
						} catch {}
					}
				} catch {}
			}

			// Sort newest first and limit to MAX_FILES
			sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
			const selectedFiles = sessionFiles.slice(0, MAX_FILES).map((f) => f.path);

			if (selectedFiles.length === 0) {
				return {
					content: [{ type: "text", text: "No historical session transcripts found on disk." }],
					details: undefined,
				};
			}

			const allDocs: SessionDoc[] = [];
			const fileDocsMap = new Map<string, SessionDoc[]>();

			for (const file of selectedFiles) {
				const { docs } = scanSessionFile(file);
				fileDocsMap.set(file, docs);
				allDocs.push(...docs);
			}

			if (allDocs.length === 0) {
				return {
					content: [{ type: "text", text: "No searchable messages found in historical sessions." }],
					details: undefined,
				};
			}

			const results = rankBm25(
				params.query,
				allDocs.map((d) => ({ id: d.id, text: d.text })),
			);

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: `No historical conversations matched "${params.query}".` }],
					details: undefined,
				};
			}

			const docById = new Map<string, SessionDoc>();
			for (const d of allDocs) {
				docById.set(d.id, d);
			}

			const limit = params.limit ?? 5;
			const hits: SessionSearchHit[] = [];

			for (const res of results.slice(0, limit)) {
				const doc = docById.get(res.id);
				if (!doc) continue;
				const fileDocs = fileDocsMap.get(doc.file) ?? [];
				const index = fileDocs.findIndex((d) => d.id === doc.id);
				const context = index === -1 ? [] : contextAround(fileDocs, index);
				hits.push({
					doc,
					score: res.score,
					context,
				});
			}

			const lines: string[] = [
				`Found ${hits.length} matching conversation excerpts for "${params.query}":\n`,
			];

			for (const hit of hits) {
				const title = hit.doc.sessionTitle || basename(hit.doc.file, ".jsonl");
				const time = shortTimestamp(hit.doc.timestamp);
				lines.push(`### [${title}]${time ? ` · ${time}` : ""} (score: ${hit.score.toFixed(2)})`);
				const snippet = hit.doc.text.length > 500 ? `${hit.doc.text.slice(0, 500)}…` : hit.doc.text;
				lines.push(`**[${hit.doc.role}]**: ${snippet}`);
				if (hit.context.length > 0) {
					lines.push("\n*Surrounding context:*");
					for (const ctxMsg of hit.context) {
						lines.push(`> ${ctxMsg}`);
					}
				}
				lines.push("\n---");
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { query: params.query, hitCount: hits.length },
			};
		},
	});
}
