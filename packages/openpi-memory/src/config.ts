import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_MEMORY_CONFIG, MEMORY_TYPES, type MemoryConfig, type MemoryType } from "./types.ts";

export function loadMemoryConfig(cwd: string): MemoryConfig {
	const candidates = [
		path.join(cwd, ".pi", "memory", "config.json"),
		path.join(process.env.HOME ?? "", ".pi", "memory", "config.json"),
		path.join(process.env.HOME ?? "", ".pi", "agent", "openpi.json"),
	];
	const config = { ...DEFAULT_MEMORY_CONFIG };
	for (const file of candidates) {
		if (!file || !fs.existsSync(file)) continue;
		try {
			const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
			if (!value || typeof value !== "object" || Array.isArray(value)) continue;
			const record = value as Record<string, unknown>;
			applyConfigFields(config, record);
			// openpi.json may nest under memory key
			if (record.memory && typeof record.memory === "object" && !Array.isArray(record.memory)) {
				applyConfigFields(config, record.memory as Record<string, unknown>);
			}
		} catch {
			// Ignore invalid config files.
		}
	}
	return config;
}

function applyConfigFields(config: MemoryConfig, record: Record<string, unknown>): void {
	if (typeof record.extractOnShutdown === "boolean") config.extractOnShutdown = record.extractOnShutdown;
	if (typeof record.includeGlobal === "boolean") config.includeGlobal = record.includeGlobal;
	if (typeof record.flushOnCompact === "boolean") config.flushOnCompact = record.flushOnCompact;
	if (typeof record.llmExtract === "boolean") config.llmExtract = record.llmExtract;
	if (typeof record.autoMaintain === "boolean") config.autoMaintain = record.autoMaintain;
	if (typeof record.maxIndexEntries === "number" && record.maxIndexEntries > 0) {
		config.maxIndexEntries = Math.floor(record.maxIndexEntries);
	}
	if (typeof record.autoMaintainEverySessions === "number" && record.autoMaintainEverySessions > 0) {
		config.autoMaintainEverySessions = Math.floor(record.autoMaintainEverySessions);
	}
	if (typeof record.autoMaintainMinIntervalMs === "number" && record.autoMaintainMinIntervalMs > 0) {
		config.autoMaintainMinIntervalMs = Math.floor(record.autoMaintainMinIntervalMs);
	}
	if (typeof record.extractOnAgentEnd === "boolean") config.extractOnAgentEnd = record.extractOnAgentEnd;
	if (typeof record.maintainGlobal === "boolean") config.maintainGlobal = record.maintainGlobal;
	if (typeof record.maxSnapshotEntries === "number" && record.maxSnapshotEntries > 0) {
		config.maxSnapshotEntries = Math.floor(record.maxSnapshotEntries);
	}
	if (Array.isArray(record.pinTypes)) {
		const pins = record.pinTypes.filter(
			(t): t is MemoryType => typeof t === "string" && (MEMORY_TYPES as readonly string[]).includes(t),
		);
		if (pins.length > 0) config.pinTypes = pins;
	}
	if (typeof record.vectorSearch === "boolean") config.vectorSearch = record.vectorSearch;
	if (typeof record.vectorAlpha === "number" && record.vectorAlpha >= 0 && record.vectorAlpha <= 1) {
		config.vectorAlpha = record.vectorAlpha;
	}
	if (typeof record.semanticSearch === "boolean") config.semanticSearch = record.semanticSearch;
	if (typeof record.autoBackup === "boolean") config.autoBackup = record.autoBackup;
	if (typeof record.maxBackups === "number" && record.maxBackups > 0) {
		config.maxBackups = Math.floor(record.maxBackups);
	}
	if (typeof record.idleOrganize === "boolean") config.idleOrganize = record.idleOrganize;
	if (typeof record.idleOrganizeMinIntervalMs === "number" && record.idleOrganizeMinIntervalMs > 0) {
		config.idleOrganizeMinIntervalMs = Math.floor(record.idleOrganizeMinIntervalMs);
	}
	if (typeof record.softDelete === "boolean") config.softDelete = record.softDelete;
	if (typeof record.searchArchive === "boolean") config.searchArchive = record.searchArchive;
	if (typeof record.archiveSearchLimit === "number" && record.archiveSearchLimit > 0) {
		config.archiveSearchLimit = Math.floor(record.archiveSearchLimit);
	}
	if (
		typeof record.archiveSearchMinScore === "number" &&
		record.archiveSearchMinScore >= 0 &&
		record.archiveSearchMinScore <= 1
	) {
		config.archiveSearchMinScore = record.archiveSearchMinScore;
	}
	if (typeof record.proactiveInject === "boolean") config.proactiveInject = record.proactiveInject;
	if (typeof record.softExtractEveryTurn === "boolean") config.softExtractEveryTurn = record.softExtractEveryTurn;
	if (typeof record.autoSessionDigest === "boolean") config.autoSessionDigest = record.autoSessionDigest;
	if (typeof record.promoteUserToGlobal === "boolean") config.promoteUserToGlobal = record.promoteUserToGlobal;
	if (typeof record.digestRefreshDuringSession === "boolean") {
		config.digestRefreshDuringSession = record.digestRefreshDuringSession;
	}
	if (typeof record.digestRefreshMinIntervalMs === "number" && record.digestRefreshMinIntervalMs > 0) {
		config.digestRefreshMinIntervalMs = Math.floor(record.digestRefreshMinIntervalMs);
	}
	if (typeof record.sessionDigestRetentionDays === "number" && record.sessionDigestRetentionDays >= 0) {
		config.sessionDigestRetentionDays = Math.floor(record.sessionDigestRetentionDays);
	}
	if (typeof record.wipRetentionDays === "number" && record.wipRetentionDays >= 0) {
		config.wipRetentionDays = Math.floor(record.wipRetentionDays);
	}
}

export function globalMemoryDir(): string {
	return path.join(process.env.HOME ?? "", ".pi", "memory");
}
