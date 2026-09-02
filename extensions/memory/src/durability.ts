/**
 * Durability layer: append-only journal, soft-archive, full backups, recovery.
 * Goal: memory is never silently lost — deletes/prunes go to archive; index rebuildable.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { MemoryIndexEntry, MemoryType } from "./types.ts";
import { MEMORY_TYPES } from "./types.ts";

// Local copies of minimal format helpers to avoid circular imports with store.ts
const INDEX_FILE = "MEMORY.md";

function topicFileName(type: MemoryType, key: string): string {
	return `${type}-${key}.md`;
}

function parseIndex(content: string): MemoryIndexEntry[] {
	const lines = content.split("\n");
	const entries: MemoryIndexEntry[] = [];
	let currentType: MemoryType | null = null;
	for (const line of lines) {
		const headingMatch = line.match(/^##\s+(user|feedback|project|lesson)$/i);
		if (headingMatch) {
			currentType = headingMatch[1].toLowerCase() as MemoryType;
			continue;
		}
		if (!currentType) continue;
		const entryMatch = line.match(/^\s*-\s*\[([^\]]+)\]\s*(.+)$/);
		if (entryMatch) {
			entries.push({ type: currentType, key: entryMatch[1]!, value: entryMatch[2]!.trim() });
		}
	}
	return entries;
}

function generateIndexContent(entries: MemoryIndexEntry[]): string {
	const byType: Record<string, MemoryIndexEntry[]> = {
		user: [],
		feedback: [],
		project: [],
		lesson: [],
	};
	for (const entry of entries) byType[entry.type]?.push(entry);
	const parts: string[] = ["# Memory Index", ""];
	for (const type of MEMORY_TYPES) {
		const typeEntries = byType[type] ?? [];
		if (typeEntries.length === 0) continue;
		parts.push(`## ${type}`);
		for (const entry of typeEntries) {
			parts.push(`- [${entry.key}] ${entry.value.replace(/\n/g, " ").slice(0, 100)}`);
		}
		parts.push("");
	}
	return `${parts.join("\n").trim()}\n`;
}

export const JOURNAL_FILE = "journal.jsonl";
export const ARCHIVE_DIR = "archive";
export const BACKUPS_DIR = "backups";

export interface ArchivedMemoryEntry extends MemoryIndexEntry {
	/** archive day folder (YYYY-MM-DD) */
	archivedOn?: string;
	reason?: string;
	body?: string;
}

export type JournalOp = "save" | "delete" | "archive" | "maintain" | "backup" | "recover" | "reindex";

export interface JournalEvent {
	at: string;
	op: JournalOp;
	type?: MemoryType | string;
	key?: string;
	value?: string;
	body?: string;
	note?: string;
}

export function journalPath(memoryDirectory: string): string {
	return path.join(memoryDirectory, JOURNAL_FILE);
}

export function appendJournal(memoryDirectory: string, event: Omit<JournalEvent, "at">): void {
	fs.mkdirSync(memoryDirectory, { recursive: true });
	const line = JSON.stringify({ at: new Date().toISOString(), ...event });
	fs.appendFileSync(journalPath(memoryDirectory), `${line}\n`, "utf8");
}

/** Soft-delete: copy topic+index entry into archive/, never hard-wipe history. */
export function archiveEntry(
	memoryDirectory: string,
	type: MemoryType,
	key: string,
	value: string,
	body?: string,
	reason = "delete",
): string {
	const day = new Date().toISOString().slice(0, 10);
	const dir = path.join(memoryDirectory, ARCHIVE_DIR, day);
	fs.mkdirSync(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const base = `${type}-${key}-${stamp}`;
	const metaFile = path.join(dir, `${base}.json`);
	const topicFile = path.join(dir, `${base}.md`);
	const topicSrc = path.join(memoryDirectory, topicFileName(type, key));
	const topicBody = body ?? (fs.existsSync(topicSrc) ? fs.readFileSync(topicSrc, "utf8") : value);
	fs.writeFileSync(
		metaFile,
		`${JSON.stringify({ type, key, value, reason, at: new Date().toISOString() }, null, 2)}\n`,
		"utf8",
	);
	fs.writeFileSync(topicFile, topicBody, "utf8");
	appendJournal(memoryDirectory, {
		op: "archive",
		type,
		key,
		value,
		body: topicBody.slice(0, 2000),
		note: reason,
	});
	return dir;
}

/**
 * List soft-deleted / pruned memories from archive/ (newest days first).
 * Used for tiered query: active first, archive when active miss/weak.
 */
export function listArchivedEntries(memoryDirectory: string, options?: { limit?: number }): ArchivedMemoryEntry[] {
	const root = path.join(memoryDirectory, ARCHIVE_DIR);
	if (!fs.existsSync(root)) return [];
	const limit = options?.limit ?? 5_000;
	const out: ArchivedMemoryEntry[] = [];
	const seen = new Set<string>();

	let days: string[] = [];
	try {
		days = fs
			.readdirSync(root)
			.filter((name) => {
				try {
					return fs.statSync(path.join(root, name)).isDirectory();
				} catch {
					return false;
				}
			})
			.sort((a, b) => b.localeCompare(a));
	} catch {
		return [];
	}

	for (const day of days) {
		const dir = path.join(root, day);
		let files: string[] = [];
		try {
			files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
		} catch {
			continue;
		}
		// newest stamps first within day
		files.sort((a, b) => b.localeCompare(a));
		for (const file of files) {
			if (out.length >= limit) return out;
			try {
				const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
					type?: string;
					key?: string;
					value?: string;
					reason?: string;
				};
				if (!raw.type || !raw.key || !raw.value) continue;
				if (!(MEMORY_TYPES as readonly string[]).includes(raw.type)) continue;
				const id = `${raw.type}:${raw.key}`;
				// keep newest archive version of each key
				if (seen.has(id)) continue;
				seen.add(id);
				const mdName = file.replace(/\.json$/, ".md");
				const mdPath = path.join(dir, mdName);
				let body: string | undefined;
				if (fs.existsSync(mdPath)) {
					try {
						body = fs.readFileSync(mdPath, "utf8");
					} catch {
						body = undefined;
					}
				}
				out.push({
					type: raw.type as MemoryType,
					key: raw.key,
					value: raw.value,
					archivedOn: day,
					reason: raw.reason,
					body,
				});
			} catch {
				/* skip corrupt */
			}
		}
	}
	return out;
}

/** Full snapshot of active index + all topic files (and vectors if present). */
export function backupMemoryDirectory(memoryDirectory: string, note = "auto"): string {
	if (!fs.existsSync(memoryDirectory)) {
		fs.mkdirSync(memoryDirectory, { recursive: true });
	}
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const dest = path.join(memoryDirectory, BACKUPS_DIR, stamp);
	fs.mkdirSync(dest, { recursive: true });

	// copy flat files
	for (const name of fs.readdirSync(memoryDirectory)) {
		if (name === ARCHIVE_DIR || name === BACKUPS_DIR) continue;
		const src = path.join(memoryDirectory, name);
		const st = fs.statSync(src);
		if (st.isFile()) {
			fs.copyFileSync(src, path.join(dest, name));
		}
	}
	fs.writeFileSync(
		path.join(dest, "_backup-meta.json"),
		`${JSON.stringify({ at: new Date().toISOString(), note }, null, 2)}\n`,
		"utf8",
	);
	appendJournal(memoryDirectory, { op: "backup", note: `${note}:${stamp}` });
	pruneOldBackups(memoryDirectory, 30);
	return dest;
}

/** Keep last N backups to control disk use (archives are never pruned). */
export function pruneOldBackups(memoryDirectory: string, keep = 30): void {
	const root = path.join(memoryDirectory, BACKUPS_DIR);
	if (!fs.existsSync(root)) return;
	const dirs = fs
		.readdirSync(root)
		.map((name) => ({ name, full: path.join(root, name) }))
		.filter((d) => fs.statSync(d.full).isDirectory())
		.sort((a, b) => b.name.localeCompare(a.name));
	for (const d of dirs.slice(keep)) {
		fs.rmSync(d.full, { recursive: true, force: true });
	}
}

/**
 * Rebuild MEMORY.md from journal saves (and existing topics) if index is missing/corrupt.
 * Never fabricates data — only replays durable log + remaining topic files.
 */
export function recoverIndex(
	memoryDirectory: string,
	maxEntries: number,
): {
	recovered: number;
	source: "index" | "journal" | "topics" | "empty";
} {
	const indexFile = path.join(memoryDirectory, INDEX_FILE);
	if (fs.existsSync(indexFile)) {
		try {
			const entries = parseIndex(fs.readFileSync(indexFile, "utf8"));
			if (entries.length > 0) return { recovered: entries.length, source: "index" };
		} catch {
			// fall through to recover
		}
	}

	fs.mkdirSync(memoryDirectory, { recursive: true });
	const map = new Map<string, MemoryIndexEntry>();

	// 1) Replay journal saves (last write wins)
	const journal = journalPath(memoryDirectory);
	if (fs.existsSync(journal)) {
		for (const line of fs.readFileSync(journal, "utf8").split("\n")) {
			if (!line.trim()) continue;
			try {
				const ev = JSON.parse(line) as JournalEvent;
				if (ev.op === "save" && ev.type && ev.key && ev.value) {
					const type = ev.type as MemoryType;
					if ((MEMORY_TYPES as readonly string[]).includes(type)) {
						map.set(`${type}:${ev.key}`, { type, key: ev.key, value: ev.value });
					}
				}
				if (ev.op === "delete" || ev.op === "archive") {
					if (ev.type && ev.key) map.delete(`${ev.type}:${ev.key}`);
				}
			} catch {
				// skip bad lines
			}
		}
	}

	// 2) Topic files still on disk fill gaps
	if (fs.existsSync(memoryDirectory)) {
		for (const name of fs.readdirSync(memoryDirectory)) {
			const m = name.match(/^(user|feedback|project|lesson)-(.+)\.md$/);
			if (!m) continue;
			const type = m[1] as MemoryType;
			const key = m[2]!;
			const id = `${type}:${key}`;
			if (map.has(id)) continue;
			const body = fs.readFileSync(path.join(memoryDirectory, name), "utf8");
			const summary =
				body
					.replace(/^#.*\n+/, "")
					.replace(/\n+Last updated:.*$/m, "")
					.trim()
					.split("\n")[0]
					?.slice(0, 100) || key;
			map.set(id, { type, key, value: summary });
		}
	}

	const entries = [...map.values()];
	const capped = entries.length > maxEntries ? entries.slice(-maxEntries) : entries;
	fs.writeFileSync(indexFile, generateIndexContent(capped), "utf8");
	appendJournal(memoryDirectory, {
		op: "recover",
		note: `recovered ${capped.length} from ${fs.existsSync(journal) ? "journal+topics" : "topics"}`,
	});

	return {
		recovered: capped.length,
		source: capped.length === 0 ? "empty" : fs.existsSync(journal) ? "journal" : "topics",
	};
}

/** Ensure durability dirs exist. */
export function ensureDurabilityLayout(memoryDirectory: string): void {
	fs.mkdirSync(memoryDirectory, { recursive: true });
	fs.mkdirSync(path.join(memoryDirectory, ARCHIVE_DIR), { recursive: true });
	fs.mkdirSync(path.join(memoryDirectory, BACKUPS_DIR), { recursive: true });
	if (!fs.existsSync(journalPath(memoryDirectory))) {
		fs.writeFileSync(journalPath(memoryDirectory), "", "utf8");
	}
}

export function listArchiveCount(memoryDirectory: string): number {
	const root = path.join(memoryDirectory, ARCHIVE_DIR);
	if (!fs.existsSync(root)) return 0;
	let n = 0;
	const walk = (dir: string) => {
		for (const name of fs.readdirSync(dir)) {
			const full = path.join(dir, name);
			if (fs.statSync(full).isDirectory()) walk(full);
			else if (name.endsWith(".json")) n += 1;
		}
	};
	walk(root);
	return n;
}

export function loadActiveOrRecover(memoryDirectory: string, maxEntries: number): MemoryIndexEntry[] {
	ensureDurabilityLayout(memoryDirectory);
	const indexFile = path.join(memoryDirectory, INDEX_FILE);
	if (fs.existsSync(indexFile)) {
		try {
			const entries = parseIndex(fs.readFileSync(indexFile, "utf8"));
			if (entries.length > 0) return entries;
		} catch {
			// recover
		}
	}
	recoverIndex(memoryDirectory, maxEntries);
	const rebuilt = path.join(memoryDirectory, INDEX_FILE);
	if (!fs.existsSync(rebuilt)) return [];
	return parseIndex(fs.readFileSync(rebuilt, "utf8"));
}
