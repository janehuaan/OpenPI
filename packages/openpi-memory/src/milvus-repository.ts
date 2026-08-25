import { DataType, MetricType, MilvusClient } from "@zilliz/milvus2-sdk-node";
import {
	type EmbeddingHealth,
	normalizeEmbedding,
	QWEN_EMBEDDING_DIMENSIONS,
	type RetrievalDocument,
	type RetrievalFilters,
	type RetrievalMatch,
	type RetrievalRepository,
} from "./retrieval.ts";

export interface MilvusConfig {
	address: string;
	collection: string;
	timeoutMs: number;
}

export function escapeMilvusString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** All fields below are mandatory tenancy/lifecycle constraints for retrieval. */
export function buildMilvusFilter(filters: RetrievalFilters): string {
	if (!filters.namespace || !filters.documentKind || !filters.state) {
		throw new Error("Milvus retrieval requires namespace, documentKind, and state filters");
	}
	return `namespace == "${escapeMilvusString(filters.namespace)}" && document_kind == "${escapeMilvusString(filters.documentKind)}" && state == "${escapeMilvusString(filters.state)}"`;
}

export class MilvusMemoryRepository implements RetrievalRepository {
	private client: MilvusClient | undefined;
	private readonly config: MilvusConfig;
	private readonly createClient: (config: MilvusConfig) => MilvusClient;

	constructor(config: MilvusConfig, createClient?: (config: MilvusConfig) => MilvusClient) {
		this.config = config;
		this.createClient =
			createClient ??
			((clientConfig) => new MilvusClient({ address: clientConfig.address, timeout: clientConfig.timeoutMs }));
	}

	async connect(): Promise<void> {
		if (this.client) return;
		try {
			this.client = this.createClient(this.config);
			await this.client.connectPromise;
		} catch (error) {
			this.client = undefined;
			throw error;
		}
	}

	async ensureSchema(): Promise<void> {
		const client = await this.requireClient();
		const exists = await client.hasCollection({ collection_name: this.config.collection });
		if (!exists.value) {
			await client.createCollection({
				collection_name: this.config.collection,
				fields: [
					{ name: "id", data_type: DataType.VarChar, is_primary_key: true, autoID: false, max_length: 128 },
					{ name: "vector", data_type: DataType.FloatVector, dim: QWEN_EMBEDDING_DIMENSIONS },
					{ name: "namespace", data_type: DataType.VarChar, max_length: 256 },
					{ name: "scope", data_type: DataType.VarChar, max_length: 256 },
					{ name: "document_kind", data_type: DataType.VarChar, max_length: 64 },
					{ name: "type", data_type: DataType.VarChar, max_length: 64 },
					{ name: "key", data_type: DataType.VarChar, max_length: 1024 },
					{ name: "state", data_type: DataType.VarChar, max_length: 32 },
					{ name: "content_hash", data_type: DataType.VarChar, max_length: 128 },
					{ name: "source_revision", data_type: DataType.VarChar, max_length: 128 },
					{ name: "updated_at", data_type: DataType.VarChar, max_length: 64 },
					{ name: "full_text", data_type: DataType.VarChar, max_length: 65535 },
				],
				index_params: [
					{
						field_name: "vector",
						index_type: "HNSW",
						metric_type: MetricType.COSINE,
						params: { M: 16, efConstruction: 256 },
					},
				],
			});
		}
		await client.loadCollection({ collection_name: this.config.collection });
	}

	async upsert(documents: readonly RetrievalDocument[]): Promise<void> {
		if (documents.length === 0) return;
		const client = await this.requireClient();
		await client.upsert({
			collection_name: this.config.collection,
			data: documents.map((document) => ({
				id: document.id,
				vector: normalizeEmbedding(document.vector),
				namespace: document.namespace,
				scope: document.scope,
				document_kind: document.documentKind,
				type: document.type,
				key: document.key,
				state: document.state,
				content_hash: document.contentHash,
				source_revision: document.sourceRevision,
				updated_at: document.updatedAt,
				full_text: document.fullText,
			})),
		});
	}

	async delete(ids: readonly string[]): Promise<void> {
		if (ids.length === 0) return;
		const client = await this.requireClient();
		await client.delete({
			collection_name: this.config.collection,
			filter: `id in [${ids.map((id) => `"${escapeMilvusString(id)}"`).join(", ")}]`,
		});
	}

	async search(vector: readonly number[], filters: RetrievalFilters, limit: number): Promise<RetrievalMatch[]> {
		const client = await this.requireClient();
		const response = await client.search({
			collection_name: this.config.collection,
			data: [normalizeEmbedding(vector)],
			anns_field: "vector",
			limit,
			expr: buildMilvusFilter(filters),
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
		return response.results.map((result: any) => ({
			score: result.score,
			document: {
				id: result.id,
				namespace: result.namespace,
				scope: result.scope,
				documentKind: result.document_kind,
				type: result.type,
				key: result.key,
				state: result.state,
				contentHash: result.content_hash,
				sourceRevision: result.source_revision,
				updatedAt: result.updated_at,
				fullText: result.full_text,
				vector: [],
			},
		}));
	}

	async health(): Promise<EmbeddingHealth> {
		try {
			await this.requireClient();
			return { ok: true, state: "ready" };
		} catch (error) {
			return { ok: false, state: "error", message: error instanceof Error ? error.message : String(error) };
		}
	}

	private async requireClient(): Promise<MilvusClient> {
		await this.connect();
		return this.client!;
	}
}
