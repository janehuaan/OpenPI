/**
 * LLM extract: prompt building + response parsing (pure).
 *
 * The new project intentionally drops the runtime LLM-extraction path: it was
 * off by default (`llmExtract: false`), depended on a model-registry API that
 * changed between 0.80 and 0.84, and heuristic extraction already covers the
 * durable-signal cases. Kept here because tests exercise the prompt/parse
 * functions and the format is still useful to regenerate later.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type ExtractCandidate, parseStructuredExtract, type TranscriptTurn } from "./extract.ts";
import { memoryDir } from "./store.ts";
import type { MemoryConfig, MemoryIndexEntry } from "./types.ts";
import { EXCLUSION_LIST } from "./types.ts";

const PENDING_LLM_FILE = "pending-llm-extract.json";

export interface PendingLlmExtract {
	at: string;
	turns: TranscriptTurn[];
	existingSummary: string;
}

export function pendingLlmPath(cwd: string): string {
	return path.join(memoryDir(cwd), PENDING_LLM_FILE);
}

export function queueLlmExtract(cwd: string, turns: TranscriptTurn[], existing: MemoryIndexEntry[]): void {
	const pending: PendingLlmExtract = {
		at: new Date().toISOString(),
		turns: turns.slice(-60),
		existingSummary: existing.map((e) => `${e.type}:${e.key}`).slice(-120).join("\n"),
	};
	fs.mkdirSync(memoryDir(cwd), { recursive: true });
	fs.writeFileSync(pendingLlmPath(cwd), JSON.stringify(pending, null, 2));
}

export function loadPendingLlmExtract(cwd: string): PendingLlmExtract | undefined {
	const file = pendingLlmPath(cwd);
	if (!fs.existsSync(file)) return undefined;
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as PendingLlmExtract;
		return parsed && Array.isArray(parsed.turns) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function clearPendingLlmExtract(cwd: string): void {
	const file = pendingLlmPath(cwd);
	if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function buildLlmExtractPrompt(pending: PendingLlmExtract): string {
	const transcript = pending.turns
		.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
		.join("\n");
	return [
		"Extract durable memories from the conversation below. Output one line per memory with the format ",
		"type:key: value, where type is user | feedback | project | lesson, key is a short kebab-case ",
		"or Chinese summary, and value is one concise line. Only output durable facts or preferences; ",
		"skip conversation-bound or code-derivable details (e.g. ",
		EXCLUSION_LIST.join("; "),
		").",
		"If nothing durable was said, output exactly NONE.",
		"",
		pending.existingSummary ? `Already known (do not repeat):\n${pending.existingSummary}\n` : "",
		`Transcript (${pending.turns.length} turns):`,
		transcript,
	].join("\n");
}

/** Parse the model's response into extract candidates. Pure + deterministic. */
export function parseLlmExtractResponse(text: string): ExtractCandidate[] {
	const trimmed = text.trim();
	if (!trimmed || /^none$/i.test(trimmed)) return [];
	const structured = parseStructuredExtract(trimmed);
	return structured.map((item) => ({
		type: item.type,
		key: item.key,
		summary: item.summary,
		body: item.body || item.summary,
		source: "structured" as const,
	}));
}
