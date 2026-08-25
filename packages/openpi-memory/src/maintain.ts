import * as fs from "node:fs";
import * as path from "node:path";
import { archiveEntry, backupMemoryDirectory } from "./durability.ts";
import { similarText } from "./extract.ts";
import {
	dedupeEntries,
	isExpiredAt,
	loadIndexFile,
	loadMetadataAt,
	memoryDir,
	metadataId,
	readTopicAt,
	sanitizeKey,
	saveIndexAt,
	saveMetadataAt,
	topicFileName,
} from "./store.ts";
import type { MemoryConfig, MemoryIndexEntry, MemoryType } from "./types.ts";
import { MEMORY_TYPES } from "./types.ts";

export interface MemoryMeta {
	lastMaintainAt?: string;
	sessionCountSinceMaintain?: number;
	lastLlmExtractAt?: string;
	lastHeuristicExtractAt?: string;
	lastIdleOrganizeAt?: string;
	lastBackupAt?: string;
	/** ISO timestamp of last mid-session / shutdown continuity digest write */
	lastDigestAt?: string;
}

export function metaPath(cwd: string): string {
	return path.join(memoryDir(cwd), "meta.json");
}

export function loadMeta(cwd: string): MemoryMeta {
	const file = metaPath(cwd);
	if (!fs.existsSync(file)) return {};
	try {
		const value = JSON.parse(fs.readFileSync(file, "utf8")) as MemoryMeta;
		return value && typeof value === "object" ? value : {};
	} catch {
		return {};
	}
}

export function saveMeta(cwd: string, meta: MemoryMeta): void {
	fs.mkdirSync(memoryDir(cwd), { recursive: true });
	fs.writeFileSync(metaPath(cwd), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

export interface MaintainResult {
	before: number;
	after: number;
	merged: number;
	pruned: number;
}

/**
 * AutoDream-style maintenance for a project cwd (`.pi/memory`).
 */
export function maintainMemoryIndex(cwd: string, config: MemoryConfig): MaintainResult {
	const result = maintainMemoryDirectory(memoryDir(cwd), config);
	const meta = loadMeta(cwd);
	meta.lastMaintainAt = new Date().toISOString();
	meta.sessionCountSinceMaintain = 0;
	saveMeta(cwd, meta);
	return result;
}

/**
 * Maintain an absolute memory directory (project `.pi/memory` or `~/.pi/memory`).
 * Always archives pruned entries — never hard-drops content.
 */
export function maintainMemoryDirectory(directory: string, config: MemoryConfig): MaintainResult {
	if (config.autoBackup) {
		try {
			backupMemoryDirectory(directory, "pre-maintain");
		} catch {
			// ignore backup failures
		}
	}

	const beforeEntries = loadIndexFile(directory);
	const before = beforeEntries.length;
	let merged = 0;
	let pruned = 0;
	const metadata = loadMetadataAt(directory);

	const byType = new Map<MemoryType, MemoryIndexEntry[]>();
	for (const type of MEMORY_TYPES) byType.set(type, []);
	for (const entry of beforeEntries) {
		byType.get(entry.type)?.push(entry);
	}

	const next: MemoryIndexEntry[] = [];
	for (const type of MEMORY_TYPES) {
		const list = byType.get(type) ?? [];
		const kept: MemoryIndexEntry[] = [];
		for (const entry of list) {
			if (isExpiredAt(directory, entry)) {
				const body = readTopicAt(directory, entry.type, entry.key);
				archiveEntry(directory, entry.type, entry.key, entry.value, body, "expired");
				const topic = path.join(directory, topicFileName(entry.type, entry.key));
				if (fs.existsSync(topic)) fs.unlinkSync(topic);
				delete metadata.entries[metadataId(entry.type, entry.key)];
				pruned += 1;
				continue;
			}
			const repaired = repairKey(
				entry.key,
				entry.value,
				type,
				new Set([...beforeEntries, ...kept].map((e) => `${e.type}:${e.key}`)),
			);
			if (repaired !== entry.key) {
				const oldTopic = path.join(directory, topicFileName(type, entry.key));
				const newTopic = path.join(directory, topicFileName(type, repaired));
				const body = readTopicAt(directory, type, entry.key);
				archiveEntry(directory, type, entry.key, entry.value, body, "repair-key");
				if (body && fs.existsSync(oldTopic) && !fs.existsSync(newTopic)) fs.renameSync(oldTopic, newTopic);
				const oldMeta = metadata.entries[metadataId(type, entry.key)];
				if (oldMeta) {
					delete metadata.entries[metadataId(type, entry.key)];
					metadata.entries[metadataId(type, repaired)] = {
						...oldMeta,
						key: repaired,
						updatedAt: new Date().toISOString(),
					};
				}
				entry.key = repaired;
			}
			if (entry.value.trim().length < 6 || /^(ok|yes|no|test|asdf|xxx)$/i.test(entry.value.trim())) {
				const body = readTopicAt(directory, entry.type, entry.key);
				archiveEntry(directory, entry.type, entry.key, entry.value, body, "prune-noise");
				// remove active topic after archive
				const topic = path.join(directory, topicFileName(entry.type, entry.key));
				if (fs.existsSync(topic)) fs.unlinkSync(topic);
				pruned += 1;
				continue;
			}
			const twin = kept.find((k) => similarText(k.value, entry.value) || k.key === entry.key);
			if (twin) {
				const prefer = entry.value.length >= twin.value.length ? entry : twin;
				const drop = prefer.key === entry.key ? twin : entry;
				const idx = kept.indexOf(twin);
				kept[idx] = {
					type,
					key: prefer.key,
					value: prefer.value.length >= entry.value.length ? prefer.value : entry.value,
				};
				mergeTopicBodiesAt(directory, type, twin.key, entry.key, kept[idx]!.key);
				if (drop.key !== prefer.key) {
					archiveEntry(
						directory,
						type,
						drop.key,
						drop.value,
						readTopicAt(directory, type, drop.key),
						"merge-duplicate",
					);
				}
				merged += 1;
			} else {
				kept.push(entry);
			}
		}
		next.push(...kept);
	}

	const deduped = dedupeEntries(next);
	const saved = saveIndexAt(directory, deduped, config.maxIndexEntries);
	saveMetadataAt(directory, metadata);
	return { before, after: saved.length, merged, pruned };
}

function repairKey(key: string, value: string, type: MemoryType, occupied: Set<string>): string {
	const canonical = sanitizeKey(key);
	const separatorCount = (key.match(/[-_]/g) ?? []).length;
	const lowInformation = canonical.length < 3 || /^[-_]+$/.test(key) || separatorCount / Math.max(1, key.length) > 0.4;
	if (!lowInformation) return key;
	const base = sanitizeKey(value).slice(0, 48) || `${type}-memory`;
	let candidate = base;
	let n = 2;
	while (occupied.has(`${type}:${candidate}`) && candidate !== key) candidate = `${base.slice(0, 56)}-${n++}`;
	return candidate;
}

/** Idle-time organize: backup + maintain + reindex when due. */
export function idleOrganize(cwd: string, config: MemoryConfig): MaintainResult | undefined {
	if (!config.idleOrganize) return undefined;
	const meta = loadMeta(cwd);
	const last = meta.lastIdleOrganizeAt ? new Date(meta.lastIdleOrganizeAt).getTime() : 0;
	if (Date.now() - last < config.idleOrganizeMinIntervalMs) return undefined;
	const result = maintainMemoryIndex(cwd, config);
	if (config.maintainGlobal) {
		const home = path.join(process.env.HOME ?? "", ".pi", "memory");
		maintainMemoryDirectory(home, config);
	}
	meta.lastIdleOrganizeAt = new Date().toISOString();
	meta.lastBackupAt = new Date().toISOString();
	saveMeta(cwd, meta);
	return result;
}

function mergeTopicBodiesAt(directory: string, type: MemoryType, keyA: string, keyB: string, keepKey: string): void {
	const read = (key: string) => {
		const file = path.join(directory, topicFileName(type, key));
		if (!fs.existsSync(file)) return "";
		return fs.readFileSync(file, "utf8");
	};
	const a = read(keyA);
	const b = keyA === keyB ? "" : read(keyB);
	const parts = [a, b]
		.map((t) =>
			t
				.replace(/^#.*\n+/, "")
				.replace(/\n+Last updated:.*$/m, "")
				.trim(),
		)
		.filter(Boolean);
	if (parts.length === 0) return;
	const body = [...new Set(parts)].join("\n\n---\n\n");
	const keepFile = path.join(directory, topicFileName(type, keepKey));
	const content = `# ${type} / ${keepKey}\n\n${body}\n\nLast updated: ${new Date().toISOString().slice(0, 10)}\n`;
	fs.mkdirSync(directory, { recursive: true });
	fs.writeFileSync(keepFile, content, "utf8");
	for (const key of [keyA, keyB]) {
		if (key === keepKey) continue;
		const file = path.join(directory, topicFileName(type, key));
		if (fs.existsSync(file)) fs.unlinkSync(file);
	}
}

export function shouldMaintain(cwd: string, config: MemoryConfig): boolean {
	if (!config.autoMaintain) return false;
	const meta = loadMeta(cwd);
	const sessions = meta.sessionCountSinceMaintain ?? 0;
	if (sessions >= config.autoMaintainEverySessions) return true;
	if (!meta.lastMaintainAt) return sessions >= 1;
	const ageMs = Date.now() - new Date(meta.lastMaintainAt).getTime();
	return ageMs >= config.autoMaintainMinIntervalMs;
}

export function bumpSessionCount(cwd: string): void {
	const meta = loadMeta(cwd);
	meta.sessionCountSinceMaintain = (meta.sessionCountSinceMaintain ?? 0) + 1;
	saveMeta(cwd, meta);
}
