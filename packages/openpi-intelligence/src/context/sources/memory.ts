import { createHash } from "node:crypto";
import { MilvusClient } from "@zilliz/milvus2-sdk-node";
import type { IntelligenceConfig } from "../../config.ts";
import type { ContextCandidate } from "../../contract.ts";
import { QwenLocalEmbeddingProvider } from "../embedding.ts";
import { createCandidate } from "../utils.ts";

const NAMESPACE_PREFIX = "openpi-memory-namespace/v1";
const COLLECTION = "openpi_memory_v1";

export interface SerializedMemoryDocument {
	version: number;
	type: string;
	key: string;
	summary: string;
	body: string;
}

export interface MilvusMemoryResult {
	id?: unknown;
	score?: unknown;
	namespace?: unknown;
	scope?: unknown;
	document_kind?: unknown;
	type?: unknown;
	key?: unknown;
	state?: unknown;
	content_hash?: unknown;
	source_revision?: unknown;
	updated_at?: unknown;
	full_text?: unknown;
}

export interface MilvusMemoryClient {
	search(request: any): Promise<any>;
}

export function deriveMemoryNamespace(cwd: string, salt = ""): string {
	return `memns_${createHash("sha256")
		.update(`${NAMESPACE_PREFIX}\0project\0${salt}\0project\0${cwd}`, "utf8")
		.digest("hex")}`;
}

export function escapeMilvusString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** State is deliberately queried separately so active memories always precede archived ones. */
export function buildMemoryFilter(namespace: string, state: "active" | "archived"): string {
	return `namespace == "${escapeMilvusString(namespace)}" && scope == "project" && document_kind == "memory" && state == "${state}"`;
}

export function parseMemoryCandidate(result: MilvusMemoryResult): ContextCandidate | undefined {
	if (
		typeof result.full_text !== "string" ||
		typeof result.namespace !== "string" ||
		result.scope !== "project" ||
		result.document_kind !== "memory" ||
		(result.state !== "active" && result.state !== "archived")
	)
		return undefined;
	let document: SerializedMemoryDocument;
	try {
		const parsed: unknown = JSON.parse(result.full_text);
		if (
			!parsed ||
			typeof parsed !== "object" ||
			typeof (parsed as SerializedMemoryDocument).summary !== "string" ||
			typeof (parsed as SerializedMemoryDocument).body !== "string" ||
			typeof (parsed as SerializedMemoryDocument).key !== "string" ||
			typeof (parsed as SerializedMemoryDocument).type !== "string"
		)
			return undefined;
		document = parsed as SerializedMemoryDocument;
	} catch {
		return undefined;
	}
	const content = [document.summary, document.body].filter(Boolean).join("\n\n");
	if (!content) return undefined;
	const key = typeof result.key === "string" ? result.key : document.key;
	const candidate = createCandidate(
		"memory",
		`memory:${document.type}:${key}`,
		document.summary || key,
		content,
		"milvus",
		{
			state: result.state,
			memoryType: document.type,
			semanticScore:
				typeof result.score === "number" && Number.isFinite(result.score) ? Math.max(0, result.score) : 0,
		},
	);
	candidate.provenance = {
		adapter: "milvus",
		observedAt: new Date().toISOString(),
		...(typeof result.id === "string" ? { sourceId: result.id } : {}),
		...(typeof result.source_revision === "string" ? { sourceRevision: result.source_revision } : {}),
		...(typeof result.updated_at === "string" ? { updatedAt: result.updated_at } : {}),
	};
	return candidate;
}

async function searchState(
	client: MilvusMemoryClient,
	vector: number[],
	namespace: string,
	state: "active" | "archived",
	limit: number,
): Promise<MilvusMemoryResult[]> {
	const response = await client.search({
		collection_name: COLLECTION,
		data: [vector],
		anns_field: "vector",
		limit,
		expr: buildMemoryFilter(namespace, state),
		output_fields: [
			"id",
			"namespace",
			"scope",
			"document_kind",
			"type",
			"key",
			"state",
			"content_hash",
			"source_revision",
			"updated_at",
			"full_text",
		],
	});
	return response.results ?? [];
}

/** Retrieves only vetted memory documents; this intentionally never reads .pi/memory. */
export async function collectMemoryCandidates(
	cwd: string,
	query: string,
	config: IntelligenceConfig,
	dependencies: { client?: MilvusMemoryClient; embedding?: QwenLocalEmbeddingProvider } = {},
): Promise<ContextCandidate[]> {
	if (config.embedding.mode === "off") {
		throw new Error('Milvus memory retrieval requires Qwen embeddings; embedding.mode must be "local".');
	}
	const embedding =
		dependencies.embedding ??
		new QwenLocalEmbeddingProvider(
			config.embedding.endpoint,
			config.embedding.model,
			config.embedding.queryInstruction,
		);
	const client =
		dependencies.client ??
		new MilvusClient({
			address: config.memoryRetrieval.milvusAddress,
			timeout: config.memoryRetrieval.milvusTimeoutMs,
		});
	let vector: number[];
	try {
		vector = await embedding.embedQuery(query);
	} catch (error) {
		throw new Error(
			`Milvus memory retrieval unavailable because Qwen embedding failed: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
	const namespace = deriveMemoryNamespace(cwd, config.memoryRetrieval.namespaceSalt);
	try {
		const [active, archived] = await Promise.all([
			searchState(client, vector, namespace, "active", config.memoryRetrieval.limit),
			searchState(client, vector, namespace, "archived", config.memoryRetrieval.limit),
		]);
		const seen = new Set<string>();
		return [...active, ...archived]
			.flatMap((result) => {
				if (result.namespace !== namespace) return [];
				const candidate = parseMemoryCandidate(result);
				if (!candidate || seen.has(candidate.id)) return [];
				seen.add(candidate.id);
				return [candidate];
			})
			.slice(0, config.memoryRetrieval.limit);
	} catch (error) {
		throw new Error(
			`Milvus memory retrieval unavailable at ${config.memoryRetrieval.milvusAddress}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
}
