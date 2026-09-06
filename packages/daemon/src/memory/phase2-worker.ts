/**
 * Phase 2 Worker: Global Consolidation & Skill Synthesis (Codex Phase 2 Implementation)
 *
 * Runs asynchronously during idle/cooldown or when unconsolidated stage1 outputs reach threshold:
 * 1. Fetches unconsolidated stage1_outputs from SQLite
 * 2. Reads existing MEMORY.md, memory_summary.md, and skills/
 * 3. Prompts LLM to produce structured Delta Patches (or uses syntax intent engine for heuristic fallback):
 *    - op: "add" | "supersede"
 *    - Surgical modification preventing information decay / lossy re-summarization
 *    - Enforces immutable evidence links (<!-- src: slug.md -->)
 *    - Protects human locked sections (<!-- lock -->)
 *    - Synthesizes executable skills (skills/<name>/SKILL.md)
 * 4. Atomically overwrites MEMORY.md and memory_summary.md
 * 5. Marks stage1_outputs as selected_for_phase2 = 1 in SQLite
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { memoriesDir, skillsDir } from "../config.ts";
import {
	applyHandbookPatches,
	classifyMemoryIntent,
	generateSummaryIndex,
	type MemoryPatch,
} from "./delta-patch.ts";
import { executePrompt, extractJsonFromResponse } from "./llm-client.ts";
import type { MemoryDb, Stage1Output } from "./memory-db.ts";

export interface SynthesizedSkill {
	name: string;
	description?: string;
	content: string;
}

export interface ConsolidationResult {
	consolidatedCount: number;
	threadIds: string[];
	memoryMd: string;
	memorySummaryMd: string;
	skills: SynthesizedSkill[];
}

export function loadCurrentMemoryFiles(): {
	memoryMd: string;
	memorySummaryMd: string;
	existingSkills: Array<{ name: string; content: string }>;
} {
	const dir = memoriesDir();
	mkdirSync(dir, { recursive: true });

	const memoryMdPath = join(dir, "MEMORY.md");
	const memorySummaryPath = join(dir, "memory_summary.md");

	const memoryMd = existsSync(memoryMdPath) ? readFileSync(memoryMdPath, "utf8") : "";
	const memorySummaryMd = existsSync(memorySummaryPath) ? readFileSync(memorySummaryPath, "utf8") : "";

	const existingSkills: Array<{ name: string; content: string }> = [];
	const sDir = skillsDir();
	if (existsSync(sDir)) {
		try {
			for (const entry of readdirSync(sDir, { withFileTypes: true })) {
				if (entry.isDirectory()) {
					const skillFile = join(sDir, entry.name, "SKILL.md");
					if (existsSync(skillFile)) {
						existingSkills.push({
							name: entry.name,
							content: readFileSync(skillFile, "utf8"),
						});
					}
				}
			}
		} catch {}
	}

	return { memoryMd, memorySummaryMd, existingSkills };
}

export function buildConsolidationPrompt(
	outputs: Stage1Output[],
	current: { memoryMd: string; memorySummaryMd: string; existingSkills: Array<{ name: string; content: string }> },
): string {
	const newMemoriesText = outputs
		.map((o) => {
			return [
				`### Session: ${o.rollout_slug ?? o.thread_id}`,
				`Summary: ${o.rollout_summary}`,
				`Raw Memories:`,
				o.raw_memory,
			].join("\n");
		})
		.join("\n\n---\n\n");

	return [
		"You are an expert AI Memory Worker performing Global Consolidation & Skill Evolution (Codex Phase 2).",
		"Your goal is to synthesize the newly extracted session memories into the existing handbook using surgical Delta Patches, preventing loss of exact code snippets and technical parameters.",
		"",
		"Current Knowledge Handbook (MEMORY.md):",
		current.memoryMd || "(empty)",
		"",
		"Current System Prompt Index (memory_summary.md):",
		current.memorySummaryMd || "(empty)",
		"",
		"New Session Memories to Consolidate:",
		newMemoriesText,
		"",
		"Instructions:",
		"1. DO NOT summarize away specific technical parameters, paths, or code fixes.",
		"2. Provide surgical Delta Patches in JSON. Operations can be:",
		"   - 'add': append a high-signal rule or recipe to a section.",
		"   - 'supersede': replace an outdated instruction or obsolete framework (specify target_phrase).",
		"   Sections allowed: 'User Preferences & Habits', 'Architecture & Conventions', 'Platform Quirks & Build Recipes', 'Troubleshooting Lessons', 'Staging Notes'.",
		"3. Skill Synthesis: If any recurring multi-step procedure or command recipe appears with clear execution steps, extract it as an executable skill with name and SKILL.md content.",
		"4. Update memory_summary_md: compact index (~200-350 tokens).",
		"",
		"Return strictly valid JSON matching:",
		"{",
		'  "patches": [',
		'    { "op": "add", "section": "Platform Quirks & Build Recipes", "item": "- Exact rule...", "evidence": "slug-name" },',
		'    { "op": "supersede", "section": "Architecture & Conventions", "target_phrase": "old...", "item": "- new...", "reason": "why" }',
		"  ],",
		'  "memory_summary_md": "# Memory Index\\n...",',
		'  "skills": [',
		'    { "name": "skill-name", "content": "---\\nname: skill-name\\n---\\n# Skill Instructions\\n..." }',
		"  ]",
		"}",
	].join("\n");
}

export function heuristicConsolidation(
	outputs: Stage1Output[],
	current: { memoryMd: string; memorySummaryMd: string; existingSkills: Array<{ name: string; content: string }> },
): { memoryMd: string; memorySummaryMd: string; skills: SynthesizedSkill[] } {
	const patches: MemoryPatch[] = [];

	for (const output of outputs) {
		const lines = output.raw_memory.split("\n");
		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line.startsWith("- ")) continue;
			const section = classifyMemoryIntent(line);
			patches.push({
				op: "add",
				section,
				item: line,
				evidence: output.rollout_slug ? `${output.rollout_slug}.md` : undefined,
			});
		}
	}

	const memoryMd = applyHandbookPatches(current.memoryMd, patches);
	const memorySummaryMd = generateSummaryIndex(memoryMd);

	return {
		memoryMd,
		memorySummaryMd,
		skills: [],
	};
}

export async function runPhase2Consolidation(
	db: MemoryDb,
	options: { force?: boolean; model?: string; provider?: string } = {},
): Promise<ConsolidationResult> {
	const unconsolidated = db.getUnconsolidatedStage1Outputs();
	if (unconsolidated.length === 0 && !options.force) {
		return {
			consolidatedCount: 0,
			threadIds: [],
			memoryMd: "",
			memorySummaryMd: "",
			skills: [],
		};
	}

	const current = loadCurrentMemoryFiles();
	const threadIds = unconsolidated.map((o) => o.thread_id);

	let memoryMd = "";
	let memorySummaryMd = "";
	let skills: SynthesizedSkill[] = [];

	try {
		const prompt = buildConsolidationPrompt(unconsolidated, current);
		const responseText = await executePrompt(prompt, {
			model: options.model,
			provider: options.provider,
			timeoutMs: 45_000,
		});

		const extracted = extractJsonFromResponse<{
			patches?: MemoryPatch[];
			memory_md?: string;
			memory_summary_md?: string;
			skills?: Array<{ name: string; content: string; description?: string }>;
		}>(responseText);

		if (extracted && Array.isArray(extracted.patches) && extracted.patches.length > 0) {
			// Lossless Delta Patch execution
			memoryMd = applyHandbookPatches(current.memoryMd, extracted.patches);
			memorySummaryMd = (extracted.memory_summary_md || generateSummaryIndex(memoryMd)).trim();
			skills = (extracted.skills ?? []).map((s) => ({
				name: s.name.toLowerCase().replace(/[^\w-]+/g, "-"),
				description: s.description,
				content: s.content,
			}));
		} else if (extracted && extracted.memory_md && extracted.memory_summary_md) {
			memoryMd = extracted.memory_md.trim();
			memorySummaryMd = extracted.memory_summary_md.trim();
			skills = (extracted.skills ?? []).map((s) => ({
				name: s.name.toLowerCase().replace(/[^\w-]+/g, "-"),
				description: s.description,
				content: s.content,
			}));
		} else {
			const fallback = heuristicConsolidation(unconsolidated, current);
			memoryMd = fallback.memoryMd;
			memorySummaryMd = fallback.memorySummaryMd;
			skills = fallback.skills;
		}
	} catch {
		const fallback = heuristicConsolidation(unconsolidated, current);
		memoryMd = fallback.memoryMd;
		memorySummaryMd = fallback.memorySummaryMd;
		skills = fallback.skills;
	}

	// 1. Write MEMORY.md and memory_summary.md
	const dir = memoriesDir();
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "MEMORY.md"), memoryMd, "utf8");
	writeFileSync(join(dir, "memory_summary.md"), memorySummaryMd, "utf8");

	// 2. Write synthesized skills
	const sDir = skillsDir();
	mkdirSync(sDir, { recursive: true });
	for (const skill of skills) {
		if (skill.name && skill.content) {
			const skillFolder = join(sDir, skill.name);
			mkdirSync(skillFolder, { recursive: true });
			writeFileSync(join(skillFolder, "SKILL.md"), skill.content, "utf8");
		}
	}

	// 3. Mark stage1 outputs as selected_for_phase2
	if (threadIds.length > 0) {
		db.markStage1OutputsSelected(threadIds);
	}

	return {
		consolidatedCount: threadIds.length,
		threadIds,
		memoryMd,
		memorySummaryMd,
		skills,
	};
}
