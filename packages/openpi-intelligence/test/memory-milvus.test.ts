import { describe, expect, it } from "vitest";
import type { IntelligenceConfig } from "../src/config.ts";
import {
	buildMemoryFilter,
	collectMemoryCandidates,
	deriveMemoryNamespace,
	parseMemoryCandidate,
} from "../src/context/sources/memory.ts";

const config: IntelligenceConfig = {
	enabled: true,
	planning: "auto",
	contextBudget: {
		totalTokens: 10_000,
		reservedForConversation: 1_000,
		reservedForCompletion: 1_000,
		sourceLimits: { conversation: 1_000, code: 1_000, git: 1_000, memory: 1_000, knowledge: 1_000, web: 0 },
		maxItems: 10,
	},
	planner: { maxNodes: 1, maxDepth: 1, maxAttempts: 1, maxCapabilitiesPerNode: 1 },
	subAgents: { maxConcurrent: 1, defaultTimeoutMs: 1, maxContextItems: 1 },
	workflow: { maxConcurrent: 1, pollIntervalMs: 1, requireApprovalAt: "high" },
	memory: { minimumScore: 0.75, minimumConfidence: 0.7, defaultTtlDays: 90 },
	memoryRetrieval: { milvusAddress: "127.0.0.1:19530", milvusTimeoutMs: 1, namespaceSalt: "salt", limit: 4 },
	embedding: { mode: "local", endpoint: "http://qwen", model: "qwen", queryInstruction: "query" },
	excludedPatterns: [],
};

describe("Milvus intelligence memory retrieval", () => {
	it("derives the same opaque project namespace as memory retrieval", () => {
		expect(deriveMemoryNamespace("/work/project", "salt")).toBe(
			"memns_5bbf2d973f9cd054b147ac1770fa5246c8022e2ec9f9f8907838619a04c22dd9",
		);
	});

	it("uses mandatory project, kind, and lifecycle filters", () => {
		const filter = buildMemoryFilter("memns_test", "active");
		expect(filter).toContain('namespace == "memns_test"');
		expect(filter).toContain('scope == "project"');
		expect(filter).toContain('document_kind == "memory"');
		expect(filter).toContain('state == "active"');
	});

	it("parses serialized full text and preserves Milvus provenance", () => {
		const candidate = parseMemoryCandidate({
			id: "mem_1",
			namespace: "memns_test",
			scope: "project",
			document_kind: "memory",
			state: "archived",
			score: 0.9,
			source_revision: "memory-v1:hash",
			full_text: JSON.stringify({
				version: 1,
				type: "project",
				key: "decision",
				summary: "Use Milvus",
				body: "Qwen retrieval is mandatory.",
			}),
		});
		expect(candidate).toMatchObject({
			source: "memory",
			uri: "memory:project:decision",
			content: "Use Milvus\n\nQwen retrieval is mandatory.",
			metadata: { state: "archived", semanticScore: 0.9 },
			provenance: { adapter: "milvus", sourceId: "mem_1", sourceRevision: "memory-v1:hash" },
		});
		expect(parseMemoryCandidate({ full_text: "not json" })).toBeUndefined();
	});

	it("queries active and archived documents without local fallback", async () => {
		const namespace = deriveMemoryNamespace("/work/project", "salt");
		const requests: Record<string, unknown>[] = [];
		const candidates = await collectMemoryCandidates("/work/project", "recall", config, {
			embedding: { embedQuery: async () => [1], embedDocuments: async () => [], name: "test" } as never,
			client: {
				search: async (request) => {
					requests.push(request);
					return {
						results: [
							{
								id: `mem_${requests.length}`,
								namespace,
								scope: "project",
								document_kind: "memory",
								state: requests.length === 1 ? "active" : "archived",
								score: 0.8,
								full_text: JSON.stringify({
									version: 1,
									type: "project",
									key: String(requests.length),
									summary: "Memory",
									body: "Body",
								}),
							},
						],
					};
				},
			},
		});
		expect(requests).toHaveLength(2);
		expect(candidates.map((candidate) => candidate.metadata.state)).toEqual(["active", "archived"]);
	});
});
