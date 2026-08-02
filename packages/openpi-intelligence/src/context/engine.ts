import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { IntelligenceConfig } from "../config.ts";
import type { ContextCandidate, SelectedContext } from "../contract.ts";
import { applySemanticScores } from "./embedding.ts";
import { selectContext } from "./ranker.ts";
import { collectCodeCandidates } from "./sources/code.ts";
import { collectConversationCandidates } from "./sources/conversation.ts";
import { collectGitCandidates } from "./sources/git.ts";
import { collectKnowledgeCandidates } from "./sources/knowledge.ts";
import { collectMemoryCandidates } from "./sources/memory.ts";
import { isExcluded } from "./utils.ts";

interface ContextPreferences {
	pins: string[];
	exclusions: string[];
}

export interface ContextSnapshot {
	runId: string;
	prompt: string;
	createdAt: string;
	candidates: ContextCandidate[];
	selected: SelectedContext[];
}

export function loadContextPreferences(cwd: string): ContextPreferences {
	const directory = path.join(cwd, ".pi", "intelligence");
	const readList = (name: string): string[] => {
		try {
			const value: unknown = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
			return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
		} catch {
			return [];
		}
	};
	return { pins: readList("pins.json"), exclusions: readList("exclusions.json") };
}

export function saveContextPreference(cwd: string, kind: "pins" | "exclusions", value: string): void {
	const directory = path.join(cwd, ".pi", "intelligence");
	fs.mkdirSync(directory, { recursive: true });
	const preferences = loadContextPreferences(cwd);
	const values = [...new Set([...preferences[kind], value])].sort();
	fs.writeFileSync(path.join(directory, `${kind}.json`), `${JSON.stringify(values, null, 2)}\n`, "utf8");
}

export async function buildContextSnapshot(
	pi: ExtensionAPI,
	cwd: string,
	prompt: string,
	messages: AgentMessage[],
	config: IntelligenceConfig,
	runId: string,
): Promise<ContextSnapshot> {
	const preferences = loadContextPreferences(cwd);
	const exclusions = [...config.excludedPatterns, ...preferences.exclusions];
	const candidateGroups = await Promise.all([
		Promise.resolve(collectCodeCandidates(cwd, prompt, exclusions)),
		collectGitCandidates(pi, cwd),
		Promise.resolve(collectMemoryCandidates(cwd, prompt)),
		Promise.resolve(collectKnowledgeCandidates(cwd, prompt)),
		Promise.resolve(collectConversationCandidates(messages, prompt)),
	]);
	const candidates = candidateGroups.flat().filter((candidate) => !isExcluded(candidate.uri, exclusions));
	await applySemanticScores(candidates, prompt, config);
	const selected = selectContext(candidates, prompt, config.contextBudget, new Set(preferences.pins));
	return { runId, prompt, createdAt: new Date().toISOString(), candidates, selected };
}

export function renderContextSnapshot(snapshot: ContextSnapshot): string {
	const items = snapshot.selected.map(
		(item) =>
			`<item id="${item.candidate.id}" source="${item.candidate.source}" uri="${item.candidate.uri}" score="${item.score.total.toFixed(3)}">\n${item.selectedContent}\n</item>`,
	);
	return `<dynamic_context run_id="${snapshot.runId}">\n${items.join("\n")}\n</dynamic_context>`;
}
