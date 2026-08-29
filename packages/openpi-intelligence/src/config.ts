import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { ContextBudget, ContextSourceKind } from "./contract.ts";

export interface IntelligenceConfig {
	enabled: boolean;
	planning: "auto" | "always" | "never";
	contextBudget: ContextBudget;
	planner: { maxNodes: number; maxDepth: number; maxAttempts: number; maxCapabilitiesPerNode: number };
	subAgents: { maxConcurrent: number; defaultTimeoutMs: number; maxContextItems: number };
	workflow: { maxConcurrent: number; pollIntervalMs: number; requireApprovalAt: "high" | "critical" };
	memory: { minimumScore: number; minimumConfidence: number; defaultTtlDays: number };
	embedding: { mode: "off" | "local" | "http"; endpoint?: string; model?: string; apiKeyEnv?: string };
	excludedPatterns: string[];
}

const sourceLimits: Record<ContextSourceKind, number> = {
	conversation: 3000,
	code: 9000,
	git: 2500,
	memory: 2000,
	knowledge: 3500,
	web: 0,
};

export const DEFAULT_INTELLIGENCE_CONFIG: IntelligenceConfig = {
	enabled: true,
	planning: "auto",
	contextBudget: {
		totalTokens: 24_000,
		reservedForConversation: 6000,
		reservedForCompletion: 8000,
		sourceLimits,
		maxItems: 20,
	},
	planner: { maxNodes: 8, maxDepth: 4, maxAttempts: 2, maxCapabilitiesPerNode: 4 },
	subAgents: { maxConcurrent: 3, defaultTimeoutMs: 300_000, maxContextItems: 8 },
	workflow: { maxConcurrent: 3, pollIntervalMs: 250, requireApprovalAt: "high" },
	memory: { minimumScore: 0.75, minimumConfidence: 0.7, defaultTtlDays: 90 },
	embedding: { mode: "local" },
	excludedPatterns: [
		".git/",
		"node_modules/",
		"dist/",
		"build/",
		"coverage/",
		".agnes/",
		".pi/intelligence/",
		".env",
		".env.*",
		"*.pem",
		"*.key",
		"credentials.json",
		"auth.json",
	],
};

function readPartial(file: string): Partial<IntelligenceConfig> {
	try {
		const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		return value && typeof value === "object" ? (value as Partial<IntelligenceConfig>) : {};
	} catch {
		return {};
	}
}

function mergeConfig(base: IntelligenceConfig, partial: Partial<IntelligenceConfig>): IntelligenceConfig {
	return {
		...base,
		...partial,
		contextBudget: {
			...base.contextBudget,
			...(partial.contextBudget ?? {}),
			sourceLimits: { ...base.contextBudget.sourceLimits, ...(partial.contextBudget?.sourceLimits ?? {}) },
		},
		planner: { ...base.planner, ...(partial.planner ?? {}) },
		subAgents: { ...base.subAgents, ...(partial.subAgents ?? {}) },
		workflow: { ...base.workflow, ...(partial.workflow ?? {}) },
		memory: { ...base.memory, ...(partial.memory ?? {}) },
		embedding: { ...base.embedding, ...(partial.embedding ?? {}) },
		excludedPatterns: partial.excludedPatterns ?? base.excludedPatterns,
	};
}

export function loadIntelligenceConfig(cwd: string): IntelligenceConfig {
	const global = readPartial(path.join(homedir(), ".pi", "agent", "intelligence.json"));
	const project = readPartial(path.join(cwd, ".pi", "intelligence", "config.json"));
	const merged = mergeConfig(mergeConfig(DEFAULT_INTELLIGENCE_CONFIG, global), project);
	return {
		...merged,
		planner: {
			maxNodes: Math.max(1, Math.min(20, merged.planner.maxNodes)),
			maxDepth: Math.max(1, Math.min(10, merged.planner.maxDepth)),
			maxAttempts: Math.max(1, Math.min(5, merged.planner.maxAttempts)),
			maxCapabilitiesPerNode: Math.max(1, Math.min(10, merged.planner.maxCapabilitiesPerNode)),
		},
		subAgents: { ...merged.subAgents, maxConcurrent: Math.max(1, Math.min(8, merged.subAgents.maxConcurrent)) },
		workflow: { ...merged.workflow, maxConcurrent: Math.max(1, Math.min(8, merged.workflow.maxConcurrent)) },
	};
}
