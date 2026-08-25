export const MEMORY_TYPES = ["user", "feedback", "project", "lesson"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryIndexEntry {
	type: MemoryType;
	key: string;
	value: string;
}
export type MemorySource = "structured" | "heuristic" | "pending" | "digest" | "manual";
export interface MemoryMetadataEntry {
	type: MemoryType;
	key: string;
	createdAt: string;
	updatedAt: string;
	expiresAt?: string;
	source?: MemorySource | string;
}
export interface MemoryMetadata {
	entries: Record<string, MemoryMetadataEntry>;
}

export interface MemoryConfig {
	extractOnShutdown: boolean;
	maxIndexEntries: number;
	includeGlobal: boolean;
	flushOnCompact: boolean;
	llmExtract: boolean;
	autoMaintain: boolean;
	autoMaintainEverySessions: number;
	autoMaintainMinIntervalMs: number;
	extractOnAgentEnd: boolean;
	maintainGlobal: boolean;
	maxSnapshotEntries: number;
	pinTypes: MemoryType[];
	autoBackup: boolean;
	maxBackups: number;
	idleOrganize: boolean;
	idleOrganizeMinIntervalMs: number;
	softDelete: boolean;
	proactiveInject: boolean;
	softExtractEveryTurn: boolean;
	autoSessionDigest: boolean;
	promoteUserToGlobal: boolean;
	digestRefreshDuringSession: boolean;
	digestRefreshMinIntervalMs: number;
	embeddingBaseUrl: string;
	embeddingModel: string;
	embeddingTimeoutMs: number;
	milvusAddress: string;
	milvusCollection: string;
	milvusTimeoutMs: number;
	strictDependency: boolean;
	namespaceSalt: string;
	vectorSearch: boolean;
	vectorAlpha: number;
	semanticSearch: boolean;
	searchArchive: boolean;
	archiveSearchLimit: number;
	archiveSearchMinScore: number;
	/** Retention for auto session digests. 0 disables expiry. */ sessionDigestRetentionDays: number;
	/** Retention for heuristic WIP project notes. 0 disables expiry. */ wipRetentionDays: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
	extractOnShutdown: true,
	maxIndexEntries: 500,
	includeGlobal: true,
	flushOnCompact: true,
	llmExtract: false,
	autoMaintain: true,
	autoMaintainEverySessions: 2,
	autoMaintainMinIntervalMs: 6 * 60 * 60 * 1000,
	extractOnAgentEnd: true,
	maintainGlobal: true,
	maxSnapshotEntries: 32,
	pinTypes: ["user", "feedback"],
	autoBackup: true,
	maxBackups: 40,
	idleOrganize: true,
	idleOrganizeMinIntervalMs: 30 * 60 * 1000,
	softDelete: true,
	proactiveInject: true,
	softExtractEveryTurn: true,
	autoSessionDigest: true,
	promoteUserToGlobal: true,
	digestRefreshDuringSession: true,
	digestRefreshMinIntervalMs: 90_000,
	embeddingBaseUrl: "http://127.0.0.1:18080/v1",
	embeddingModel: "qwen3-embedding-0.6b",
	embeddingTimeoutMs: 15_000,
	milvusAddress: "127.0.0.1:19530",
	milvusCollection: "openpi_memory_v1",
	milvusTimeoutMs: 10_000,
	strictDependency: false,
	namespaceSalt: "",
	vectorSearch: true,
	vectorAlpha: 0.65,
	semanticSearch: false,
	searchArchive: true,
	archiveSearchLimit: 50,
	archiveSearchMinScore: 0.25,
	sessionDigestRetentionDays: 7,
	wipRetentionDays: 14,
};

export const EXCLUSION_LIST = [
	"Code patterns derivable from git/codebase",
	"In-progress task state",
	"Debugging recipes specific to one session",
	"Conversation-bound details",
	"File structure (use grep/find instead)",
];
