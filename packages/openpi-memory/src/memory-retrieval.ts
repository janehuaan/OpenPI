import { createHash } from "node:crypto";
import { loadMilvusIndexState, milvusIndexStatePath, writeMilvusIndexState } from "./milvus-index-state.ts";
import { MilvusMemoryRepository } from "./milvus-repository.ts";
import { QwenEmbeddingClient } from "./qwen-embeddings.ts";
import type {
	EmbeddingClient,
	EmbeddingHealth,
	MemoryRecordState,
	RetrievalDocument,
	RetrievalMatch,
	RetrievalRepository,
} from "./retrieval.ts";
import type { MemoryConfig, MemoryIndexEntry } from "./types.ts";

const SERIALIZATION_VERSION = 1;
const NAMESPACE_PREFIX = "openpi-memory-namespace/v1";
const DOCUMENT_PREFIX = "openpi-memory-document/v1";
export type MemoryScope = "project" | "global";
export type MemoryBodyResolver = (entry: MemoryIndexEntry) => string | undefined;
export interface MemoryRetrievalDependencies {
	embedding?: EmbeddingClient;
	repository?: RetrievalRepository;
	now?: () => Date;
}
export interface MemoryRetrievalHealth {
	ok: boolean;
	embedding: EmbeddingHealth;
	repository: EmbeddingHealth;
	message?: string;
}
export interface MemoryRetrievalHit {
	entry: MemoryIndexEntry;
	match: RetrievalMatch;
}
export interface UpsertMemoryEntriesOptions {
	scope: MemoryScope;
	cwd: string;
	state?: Extract<MemoryRecordState, "active" | "archived">;
	bodyResolver?: MemoryBodyResolver /** Defaults to <canonical memory dir>/milvus-index-state.json. */;
	statePath?: string;
}
export interface QueryMemoryEntriesOptions {
	scope: MemoryScope;
	cwd: string;
	limit?: number;
	states?: readonly Extract<MemoryRecordState, "active" | "archived">[];
}
function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}
export function deriveMemoryNamespace(cwd: string, scope: MemoryScope, salt = ""): string {
	const identity = scope === "global" ? "global" : `project\0${cwd}`;
	return `memns_${sha256(`${NAMESPACE_PREFIX}\0${scope}\0${salt}\0${identity}`)}`;
}
export function deriveMemoryDocumentId(
	namespace: string,
	scope: MemoryScope,
	entry: Pick<MemoryIndexEntry, "type" | "key">,
): string {
	return `mem_${sha256(`${DOCUMENT_PREFIX}\0${namespace}\0${scope}\0${entry.type}\0${entry.key}`)}`;
}
export function stripTopicMarkdownBoilerplate(body: string | undefined): string {
	const lines = (body ?? "").replace(/\r\n?/g, "\n").split("\n");
	while (lines[0]?.trim() === "") lines.shift();
	if (/^#\s+[^\n]+\s*\/\s*[^\n]+\s*$/.test(lines[0] ?? "")) lines.shift();
	while (lines[0]?.trim() === "") lines.shift();
	while (lines.at(-1)?.trim() === "") lines.pop();
	if (/^Last updated:\s*[^\n]+\s*$/i.test(lines.at(-1) ?? "")) lines.pop();
	while (lines.at(-1)?.trim() === "") lines.pop();
	return lines.join("\n");
}
export function serializeMemoryDocument(entry: MemoryIndexEntry, body?: string): string {
	return JSON.stringify({
		version: SERIALIZATION_VERSION,
		type: entry.type,
		key: entry.key,
		summary: entry.value.trim(),
		body: stripTopicMarkdownBoilerplate(body),
	});
}
export function createMemoryRetrievalDocument(
	entry: MemoryIndexEntry,
	options: {
		cwd: string;
		scope: MemoryScope;
		body?: string;
		state?: Extract<MemoryRecordState, "active" | "archived">;
		vector: number[];
		config: Pick<MemoryConfig, "namespaceSalt">;
		now?: Date;
	},
): RetrievalDocument {
	const namespace = deriveMemoryNamespace(options.cwd, options.scope, options.config.namespaceSalt);
	const fullText = serializeMemoryDocument(entry, options.body);
	const contentHash = sha256(fullText);
	return {
		id: deriveMemoryDocumentId(namespace, options.scope, entry),
		namespace,
		scope: options.scope,
		documentKind: "memory",
		type: entry.type,
		key: entry.key,
		state: options.state ?? "active",
		contentHash,
		sourceRevision: `memory-v${SERIALIZATION_VERSION}:${contentHash}`,
		updatedAt: (options.now ?? new Date()).toISOString(),
		fullText,
		vector: options.vector,
	};
}

export class MemoryRetrievalService {
	private readonly embedding: EmbeddingClient;
	private readonly repository: RetrievalRepository;
	private readonly now: () => Date;
	private readonly config: MemoryConfig;
	private ready = false;
	constructor(config: MemoryConfig, dependencies: MemoryRetrievalDependencies = {}) {
		this.config = config;
		this.embedding =
			dependencies.embedding ??
			new QwenEmbeddingClient({
				baseUrl: config.embeddingBaseUrl,
				model: config.embeddingModel,
				timeoutMs: config.embeddingTimeoutMs,
				apiKey: process.env.OPENPI_EMBEDDING_API_KEY,
			});
		this.repository =
			dependencies.repository ??
			new MilvusMemoryRepository({
				address: config.milvusAddress,
				collection: config.milvusCollection,
				timeoutMs: config.milvusTimeoutMs,
			});
		this.now = dependencies.now ?? (() => new Date());
	}
	async health(): Promise<MemoryRetrievalHealth> {
		const [embedding, repository] = await Promise.all([this.embedding.health(), this.repository.health()]);
		const ok = embedding.ok && repository.ok;
		return { ok, embedding, repository, ...(ok ? {} : { message: this.dependencyMessage(embedding, repository) }) };
	}
	async ensureReady(): Promise<boolean> {
		if (this.ready) return true;
		try {
			await this.repository.connect();
			await this.repository.ensureSchema();
			const health = await this.health();
			if (!health.ok) throw new Error(health.message);
			this.ready = true;
			return true;
		} catch (error) {
			this.ready = false;
			if (this.config.strictDependency) throw this.dependencyError(error);
			return false;
		}
	}
	async upsertEntries(
		entries: readonly MemoryIndexEntry[],
		options: UpsertMemoryEntriesOptions,
	): Promise<RetrievalDocument[]> {
		if (entries.length === 0 || !(await this.ensureReady())) return [];
		try {
			const namespace = deriveMemoryNamespace(options.cwd, options.scope, this.config.namespaceSalt);
			const statePath = options.statePath ?? milvusIndexStatePath(options.cwd);
			const indexState = loadMilvusIndexState(statePath, {
				model: this.config.embeddingModel,
				dim: 1024,
				collection: this.config.milvusCollection,
			});
			const pending = entries
				.map((entry) => ({
					entry,
					body: options.bodyResolver?.(entry),
					fullText: serializeMemoryDocument(entry, options.bodyResolver?.(entry)),
					id: deriveMemoryDocumentId(namespace, options.scope, entry),
				}))
				.filter((item) => indexState.records[item.id] !== sha256(item.fullText));
			if (pending.length === 0) return [];
			const vectors = await this.embedding.embedDocuments(pending.map((item) => item.fullText));
			if (vectors.length !== pending.length)
				throw new Error(`Embedding service returned ${vectors.length} vectors for ${pending.length} memories`);
			const documents = pending.map((item, index) =>
				createMemoryRetrievalDocument(item.entry, {
					cwd: options.cwd,
					scope: options.scope,
					body: item.body,
					state: options.state,
					vector: vectors[index]!,
					config: this.config,
					now: this.now(),
				}),
			);
			await this.repository.upsert(documents);
			for (const document of documents) indexState.records[document.id] = document.contentHash;
			writeMilvusIndexState(statePath, indexState);
			return documents;
		} catch (error) {
			if (this.config.strictDependency) throw this.dependencyError(error);
			return [];
		}
	}
	async deleteEntry(
		entry: Pick<MemoryIndexEntry, "type" | "key">,
		options: { cwd: string; scope: MemoryScope },
	): Promise<void> {
		if (!(await this.ensureReady())) return;
		try {
			const namespace = deriveMemoryNamespace(options.cwd, options.scope, this.config.namespaceSalt);
			await this.repository.delete([deriveMemoryDocumentId(namespace, options.scope, entry)]);
		} catch (error) {
			if (this.config.strictDependency) throw this.dependencyError(error);
		}
	}
	async queryEntries(query: string, options: QueryMemoryEntriesOptions): Promise<MemoryRetrievalHit[]> {
		if (!query.trim() || !(await this.ensureReady())) return [];
		try {
			const [vector] = await this.embedding.embedQueries([query]);
			if (!vector) throw new Error("Embedding service returned no query vector");
			const namespace = deriveMemoryNamespace(options.cwd, options.scope, this.config.namespaceSalt);
			const limit = options.limit ?? 20;
			const states = options.states ?? ["active", "archived"];
			const results = await Promise.all(
				states.map(async (state) => ({
					state,
					hits: await this.repository.search(vector, { namespace, documentKind: "memory", state }, limit),
				})),
			);
			const seen = new Set<string>();
			return results
				.flatMap(({ hits }) => hits)
				.filter(
					(hit) =>
						hit.document.namespace === namespace &&
						hit.document.scope === options.scope &&
						!seen.has(hit.document.id) &&
						Boolean(seen.add(hit.document.id)),
				)
				.sort((a, b) => b.score - a.score)
				.slice(0, limit)
				.map((match) => ({
					entry: {
						type: match.document.type as MemoryIndexEntry["type"],
						key: match.document.key,
						value: readSummary(match.document.fullText),
					},
					match,
				}));
		} catch (error) {
			if (this.config.strictDependency) throw this.dependencyError(error);
			return [];
		}
	}
	private dependencyMessage(embedding: EmbeddingHealth, repository: EmbeddingHealth): string {
		return `Memory retrieval dependency unavailable: embedding (${embedding.message ?? embedding.state}); Milvus (${repository.message ?? repository.state}).`;
	}
	private dependencyError(error: unknown): Error {
		return new Error(
			`Memory retrieval strictDependency is enabled but Qwen embeddings or Milvus is unavailable: ${error instanceof Error ? error.message : String(error)}.`,
		);
	}
}
function readSummary(fullText: string): string {
	try {
		const parsed = JSON.parse(fullText) as { summary?: unknown };
		return typeof parsed.summary === "string" ? parsed.summary : "";
	} catch {
		return "";
	}
}
