/**
 * Stage 1 Worker: Thread Extraction (Codex Stage 1 Implementation)
 *
 * Runs asynchronously after an agent session settles or closes:
 * 1. Reads ~/.openpi/sessions/<sessionId>.jsonl
 * 2. Prompts the LLM (with robust heuristic fallback) to extract:
 *    - raw_memory: durable bullet points of facts, preferences, lessons learned
 *    - rollout_summary: narrative 2-4 sentence summary of what was accomplished
 *    - rollout_slug: short semantic identifier
 * 3. Saves to SQLite (stage1_outputs) and writes rollout_summaries/<date>-<slug>.md
 * 4. Appends to raw_memories.md
 * 5. If unconsolidated outputs >= 3, enqueues Phase 2 Global Consolidation
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoriesDir, rolloutSummariesDir, sessionsDir } from "../config.ts";
import { classifyMemoryIntent } from "./delta-patch.ts";
import { executePrompt, extractJsonFromResponse } from "./llm-client.ts";
import type { MemoryDb, Stage1Output } from "./memory-db.ts";

export interface SessionTurn {
	role: "user" | "assistant";
	text: string;
	toolCalls?: string[];
}

export interface ParsedSession {
	sessionId: string;
	cwd?: string;
	mtimeMs: number;
	turns: SessionTurn[];
}

export function parseSessionFile(sessionId: string, filePath?: string): ParsedSession | null {
	const targetPath = filePath ?? join(sessionsDir(), `${sessionId}.jsonl`);
	if (!existsSync(targetPath)) return null;

	let statMtime = Date.now();
	try {
		statMtime = statSync(targetPath).mtimeMs;
	} catch {}

	const content = readFileSync(targetPath, "utf8");
	const lines = content.split("\n");

	let cwd: string | undefined;
	const turns: SessionTurn[] = [];

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const parsed = JSON.parse(trimmed);
			if (parsed.type === "session" && parsed.cwd) {
				cwd = parsed.cwd;
			} else if (parsed.type === "message" && parsed.message) {
				const msg = parsed.message;
				const role = msg.role;
				if (role === "user" || role === "assistant") {
					let text = "";
					const toolCalls: string[] = [];
					if (Array.isArray(msg.content)) {
						for (const part of msg.content) {
							if (part.type === "text" && typeof part.text === "string") {
								text += part.text + "\n";
							} else if (part.type === "tool_call" && part.name) {
								toolCalls.push(part.name);
							}
						}
					} else if (typeof msg.content === "string") {
						text = msg.content;
					}
					text = text.trim();
					if (text || toolCalls.length > 0) {
						turns.push({ role, text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined });
					}
				}
			}
		} catch {
			// ignore corrupt lines
		}
	}

	return {
		sessionId,
		cwd,
		mtimeMs: statMtime,
		turns,
	};
}

export function buildStage1Prompt(session: ParsedSession): string {
	const transcript = session.turns
		.slice(-20) // Focus on recent relevant turns
		.map((turn) => {
			const prefix = turn.role === "user" ? "User: " : "Assistant: ";
			const toolNote = turn.toolCalls ? ` [Tools: ${turn.toolCalls.join(", ")}]` : "";
			return `${prefix}${turn.text}${toolNote}`;
		})
		.join("\n\n");

	return [
		"You are an expert AI Memory Worker performing Thread Extraction (Codex Stage 1).",
		"Analyze the conversation transcript below and extract 3 things:",
		"1. raw_memory: A bulleted list of durable, reusable lessons, user preferences, explicit instructions/corrections, project architectural decisions, environment quirks, and successful troubleshooting recipes discovered during this session. Ignore transient chat greetings or temporary debug details.",
		"2. rollout_summary: A 2-4 sentence narrative summary describing: What the user requested, what approaches were taken, what worked or failed, and the final state.",
		"3. rollout_slug: A concise kebab-case slug (e.g. 'electron-tray-diagnostics' or 'vitest-coverage-fix') summarizing this session topic.",
		"",
		"Return strictly valid JSON in this exact structure:",
		"{",
		'  "raw_memory": "- Bullet 1\\n- Bullet 2",',
		'  "rollout_summary": "The user requested... We implemented... The result was...",',
		'  "rollout_slug": "short-topic-slug"',
		"}",
		"",
		`Workspace: ${session.cwd ?? "unknown"}`,
		`Session ID: ${session.sessionId}`,
		"Transcript:",
		transcript,
	].join("\n");
}

export function heuristicStage1Extract(session: ParsedSession): {
	raw_memory: string;
	rollout_summary: string;
	rollout_slug: string;
} {
	const userTurns = session.turns.filter((t) => t.role === "user");
	const assistantTurns = session.turns.filter((t) => t.role === "assistant");

	const firstUser = userTurns[0]?.text ?? "General interaction";
	const lastUser = userTurns[userTurns.length - 1]?.text ?? "";
	const lastAssistant = assistantTurns[assistantTurns.length - 1]?.text ?? "Completed turn.";

	// Generate clean slug
	const firstLine = (userTurns[0]?.text ?? "session").split("\n")[0].trim();
	const slugCandidate = firstLine
		.toLowerCase()
		.replace(/[^\w\u4e00-\u9fa5]+/g, "-")
		.slice(0, 30)
		.replace(/^-+|-+$/g, "");
	const rollout_slug = slugCandidate || `session-${session.sessionId.slice(0, 8)}`;

	// Extract candidate memory items
	const memoryBullets: string[] = [];
	for (const turn of userTurns) {
		const lines = turn.text.split("\n");
		for (const line of lines) {
			const clean = line.trim();
			if (clean.length < 4) continue;
			const category = classifyMemoryIntent(clean);
			if (
				category !== "Staging Notes" ||
				clean.includes("必须") ||
				clean.includes("不要") ||
				clean.includes("总是") ||
				clean.includes("偏好") ||
				clean.includes("要求") ||
				clean.includes("always") ||
				clean.includes("prefer") ||
				clean.includes("never") ||
				clean.includes("require") ||
				clean.includes("need") ||
				clean.includes("should") ||
				clean.includes("fix") ||
				clean.includes("bug")
			) {
				memoryBullets.push(`- ${clean}`);
			}
		}
	}

	if (memoryBullets.length === 0) {
		memoryBullets.push(`- User objective in this session: ${firstUser.slice(0, 100)}`);
	}

	const rollout_summary = `The user worked on: "${firstUser.slice(0, 100)}". The assistant executed ${assistantTurns.length} response(s) and reached conclusion: "${lastAssistant.slice(0, 150).replace(/\n/g, " ")}".`;

	return {
		raw_memory: memoryBullets.slice(0, 5).join("\n"),
		rollout_summary,
		rollout_slug,
	};
}

export async function runStage1Worker(
	sessionId: string,
	db: MemoryDb,
	options: { model?: string; provider?: string } = {},
): Promise<Stage1Output | null> {
	const parsed = parseSessionFile(sessionId);
	if (!parsed || parsed.turns.length === 0) {
		// No transcript to extract
		return null;
	}

	let raw_memory: string;
	let rollout_summary: string;
	let rollout_slug: string;

	try {
		const prompt = buildStage1Prompt(parsed);
		const responseText = await executePrompt(prompt, {
			model: options.model,
			provider: options.provider,
			timeoutMs: 35_000,
		});

		const extracted = extractJsonFromResponse<{
			raw_memory?: string;
			rollout_summary?: string;
			rollout_slug?: string;
		}>(responseText);

		if (extracted && extracted.raw_memory && extracted.rollout_summary) {
			raw_memory = extracted.raw_memory.trim();
			rollout_summary = extracted.rollout_summary.trim();
			rollout_slug = (extracted.rollout_slug ?? `session-${sessionId.slice(0, 8)}`)
				.toLowerCase()
				.replace(/[^\w-]+/g, "-")
				.replace(/^-+|-+$/g, "");
		} else {
			const fallback = heuristicStage1Extract(parsed);
			raw_memory = fallback.raw_memory;
			rollout_summary = fallback.rollout_summary;
			rollout_slug = fallback.rollout_slug;
		}
	} catch {
		// Fallback to pure deterministic heuristic on model absence/timeout
		const fallback = heuristicStage1Extract(parsed);
		raw_memory = fallback.raw_memory;
		rollout_summary = fallback.rollout_summary;
		rollout_slug = fallback.rollout_slug;
	}

	const now = Date.now();
	const datePrefix = new Date(now).toISOString().slice(0, 10);
	const slugFileName = `${datePrefix}-${rollout_slug}.md`;

	// 1. Save output into SQLite state machine
	const stage1Record: Stage1Output = {
		thread_id: sessionId,
		source_updated_at: parsed.mtimeMs,
		raw_memory,
		rollout_summary,
		rollout_slug,
		generated_at: now,
		usage_count: 0,
		last_usage: null,
		selected_for_phase2: 0,
		selected_for_phase2_source_updated_at: null,
	};
	db.saveStage1Output(stage1Record);

	// 2. Write narrative markdown to ~/.openpi/memories/rollout_summaries/
	const globalSummariesDir = rolloutSummariesDir();
	mkdirSync(globalSummariesDir, { recursive: true });
	const summaryContent = [
		`# Rollout Summary: ${rollout_slug}`,
		"",
		`- **Session ID**: \`${sessionId}\``,
		`- **Generated At**: ${new Date(now).toISOString()}`,
		`- **Workspace**: \`${parsed.cwd ?? "global"}\``,
		"",
		"## Narrative Summary",
		rollout_summary,
		"",
		"## Extracted Raw Memories",
		raw_memory,
		"",
	].join("\n");

	const globalFilePath = join(globalSummariesDir, slugFileName);
	writeFileSync(globalFilePath, summaryContent, "utf8");

	// If workspace exists, also mirror to project's .pi/memory/rollout_summaries/
	if (parsed.cwd && existsSync(parsed.cwd)) {
		try {
			const projectSummariesDir = join(parsed.cwd, ".pi", "memory", "rollout_summaries");
			mkdirSync(projectSummariesDir, { recursive: true });
			writeFileSync(join(projectSummariesDir, slugFileName), summaryContent, "utf8");
		} catch {}
	}

	// 3. Append to raw_memories.md in memoriesDir
	try {
		const rawMemoriesPath = join(memoriesDir(), "raw_memories.md");
		const rawEntry = [
			`### [${datePrefix}] ${rollout_slug} (\`${sessionId.slice(0, 8)}\`)`,
			raw_memory,
			"",
		].join("\n");
		appendFileSync(rawMemoriesPath, rawEntry, "utf8");
	} catch {}

	// 4. Check if unconsolidated outputs >= 3, if so auto-enqueue global consolidation
	const unconsolidated = db.getUnconsolidatedStage1Outputs();
	if (unconsolidated.length >= 3) {
		db.enqueueJob("memory_consolidate_global", "global");
	}

	return stage1Record;
}
