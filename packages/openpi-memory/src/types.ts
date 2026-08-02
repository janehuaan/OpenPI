export const MEMORY_TYPES = ["user", "feedback", "project", "lesson"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export interface MemoryIndexEntry {
	type: MemoryType;
	key: string;
	value: string;
}

export interface MemoryConfig {
	/** When true, attempt light extraction on session shutdown. Default true. */
	extractOnShutdown: boolean;
	/** Max index entries. Default 200. */
	maxIndexEntries: number;
	/** Merge user-global ~/.pi/memory into freeze snapshot. Default true. */
	includeGlobal: boolean;
	/** Ask model to save durable memories before compact. Default true. */
	flushOnCompact: boolean;
	/**
	 * Queue transcript for model extract on next session start.
	 * Default **false** — fully local by default (heuristics only).
	 * Only enable if you intentionally want the *local session model* to extract
	 * (still no remote embedding / vector service).
	 */
	llmExtract: boolean;
	/** Run AutoDream merge/prune maintenance. Default true. */
	autoMaintain: boolean;
	/** Run maintenance after this many sessions. Default 3. */
	autoMaintainEverySessions: number;
	/** Minimum ms between maintenance runs. Default 12h. */
	autoMaintainMinIntervalMs: number;
	/** Soft-extract high-confidence preferences after each agent turn. Default true. */
	extractOnAgentEnd: boolean;
	/** Also maintain ~/.pi/memory when project maintain runs. Default true. */
	maintainGlobal: boolean;
	/**
	 * Max entries injected per turn (after pinning user/feedback).
	 * Large freezes waste tokens; BM25 picks the rest from the prompt. Default 24.
	 */
	maxSnapshotEntries: number;
	/** Types always included in the freeze inject (order preserved). Default user+feedback. */
	pinTypes: MemoryType[];
	/** Hybrid vector+BM25 retrieval. Default true. */
	vectorSearch: boolean;
	/** Blend weight for vector score in hybrid search (0–1). Default 0.55. */
	vectorAlpha: number;
	/** Auto backup before maintain / idle organize. Default true. */
	autoBackup: boolean;
	/** Keep last N full backups (archives never deleted). Default 40. */
	maxBackups: number;
	/** Idle organize after agent settles (reindex + light maintain). Default true. */
	idleOrganize: boolean;
	/** Min ms between idle organizes. Default 30 minutes. */
	idleOrganizeMinIntervalMs: number;
	/** Soft-delete to archive/ instead of hard delete. Default true (never lose). */
	softDelete: boolean;
	/**
	 * When active hybrid search is empty/weak, also search soft-deleted archive/.
	 * Default true — never lose recall for pruned/overflow entries.
	 */
	searchArchive: boolean;
	/** Max archive entries scanned on fallback. Default 5000. */
	archiveSearchLimit: number;
	/**
	 * If top active hit score is below this, also merge archive hits.
	 * Default 0.25.
	 */
	archiveSearchMinScore: number;
	/**
	 * Every user turn: inject ranked long-term memory into the model context
	 * without the user asking. Default true (cross-session recall is automatic).
	 */
	proactiveInject: boolean;
	/**
	 * Soft-extract durable signals every agent_end (not only explicit “记住”).
	 * Default true.
	 */
	softExtractEveryTurn: boolean;
	/**
	 * Save a short project “last session” digest on shutdown for cross-chat continuity.
	 * Default true.
	 */
	autoSessionDigest: boolean;
	/**
	 * Write user/feedback extracts to ~/.pi/memory as well as project.
	 * Default true so preferences follow the user across workspaces.
	 */
	promoteUserToGlobal: boolean;
	/**
	 * Refresh session continuity digest during the session (agent_settled / rich agent_end),
	 * not only on shutdown. Default true.
	 */
	digestRefreshDuringSession: boolean;
	/** Min ms between mid-session digest refreshes. Default 90s. */
	digestRefreshMinIntervalMs: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
	extractOnShutdown: true,
	// Active index cap — overflow stays in journal/archive forever
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
	vectorSearch: true,
	vectorAlpha: 0.55,
	autoBackup: true,
	maxBackups: 40,
	idleOrganize: true,
	idleOrganizeMinIntervalMs: 30 * 60 * 1000,
	softDelete: true,
	searchArchive: true,
	archiveSearchLimit: 5000,
	archiveSearchMinScore: 0.25,
	proactiveInject: true,
	softExtractEveryTurn: true,
	autoSessionDigest: true,
	promoteUserToGlobal: true,
	digestRefreshDuringSession: true,
	digestRefreshMinIntervalMs: 90_000,
};

export const EXCLUSION_LIST = [
	"Code patterns derivable from git/codebase",
	"In-progress task state",
	"Debugging recipes specific to one session",
	"Conversation-bound details",
	"File structure (use grep/find instead)",
];
