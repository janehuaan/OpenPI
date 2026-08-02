import * as fs from "node:fs";
import * as path from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import { applyCandidates, type ExtractCandidate, parseStructuredExtract, type TranscriptTurn } from "./extract.ts";
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

/** Persist a compact transcript digest for LLM extract on next session start. */
export function queueLlmExtract(cwd: string, turns: TranscriptTurn[], existing: MemoryIndexEntry[]): void {
	if (turns.length === 0) return;
	// Keep last 30 turns, truncate text
	const compact: TranscriptTurn[] = turns.slice(-30).map((t) => ({
		role: t.role,
		text: t.text.slice(0, 600),
	}));
	const existingSummary = existing
		.slice(-40)
		.map((e) => `[${e.type}/${e.key}] ${e.value}`)
		.join("\n");
	const payload: PendingLlmExtract = {
		at: new Date().toISOString(),
		turns: compact,
		existingSummary,
	};
	fs.mkdirSync(memoryDir(cwd), { recursive: true });
	fs.writeFileSync(pendingLlmPath(cwd), `${JSON.stringify(payload)}\n`, "utf8");
}

export function loadPendingLlmExtract(cwd: string): PendingLlmExtract | undefined {
	const file = pendingLlmPath(cwd);
	if (!fs.existsSync(file)) return undefined;
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as PendingLlmExtract;
	} catch {
		return undefined;
	}
}

export function clearPendingLlmExtract(cwd: string): void {
	const file = pendingLlmPath(cwd);
	if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function buildLlmExtractPrompt(pending: PendingLlmExtract): string {
	const transcript = pending.turns.map((t) => `${t.role.toUpperCase()}: ${t.text}`).join("\n\n");
	return [
		"Extract durable long-term memories from this conversation for a coding agent.",
		"Output ONLY lines in this format (max 8 lines):",
		"type:key: short summary",
		"Types: user | feedback | project | lesson",
		"key: kebab-case ascii only",
		"",
		"Do NOT store:",
		...EXCLUSION_LIST.map((x) => `- ${x}`),
		"",
		"Existing memories (avoid duplicates):",
		pending.existingSummary || "(none)",
		"",
		"Transcript:",
		transcript,
		"",
		"If nothing durable, output exactly: NONE",
	].join("\n");
}

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

export type ModelRegistryLike = {
	getApiKeyAndHeaders: (
		model: Model<any>,
	) => Promise<
		| { ok: true; apiKey?: string; headers?: Record<string, string>; env?: Record<string, string> }
		| { ok: false; error: string }
	>;
};

/**
 * Optional model extract from a pending queue using the *session* model.
 * Disabled by default (`llmExtract: false`) so memory stays fully local:
 * heuristics + local vectors only — never a remote embedding service.
 */
export async function runPendingLlmExtract(
	cwd: string,
	config: MemoryConfig,
	model: Model<any> | undefined,
	modelRegistry: ModelRegistryLike | undefined,
	signal?: AbortSignal,
): Promise<number> {
	if (!config.llmExtract) {
		// Drop stale queue so we don't keep remote-bound work around
		clearPendingLlmExtract(cwd);
		return 0;
	}
	const pending = loadPendingLlmExtract(cwd);
	if (!pending || pending.turns.length === 0) {
		clearPendingLlmExtract(cwd);
		return 0;
	}
	if (!model || !modelRegistry) {
		// Keep queue for a later session that has a model
		return 0;
	}

	const auth = await modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return 0;

	try {
		const response = await complete(
			model,
			{
				systemPrompt: "You extract durable agent memories. Reply only with structured memory lines or NONE.",
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: buildLlmExtractPrompt(pending) }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				env: auth.env,
				signal,
				maxTokens: 800,
			},
		);

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
		const candidates = parseLlmExtractResponse(text);
		const saved = applyCandidates(cwd, candidates, config);
		clearPendingLlmExtract(cwd);
		return saved;
	} catch {
		// Leave queue for retry
		return 0;
	}
}
