import * as fs from "node:fs";
import * as path from "node:path";
import { appendJournal, archiveEntry, ensureDurabilityLayout } from "./durability.ts";
import { MEMORY_TYPES, type MemoryIndexEntry, type MemoryType } from "./types.ts";

export const MEMORY_DIR = ".pi/memory";
export const INDEX_FILE = "MEMORY.md";

export const METADATA_FILE = "memory-metadata.json";

/**
 * Canonical file-safe key: normalize compatibility variants but preserve all
 * Unicode letters and numbers (including CJK). Unsafe runs become one hyphen.
 */
export function sanitizeKey(key: string): string {
	return key
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}_-]+/gu, "-")
		.replace(/[-_]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
		.replace(/-+$/g, "");
}

export function metadataPathAt(memoryDirectory: string): string {
	return path.join(memoryDirectory, METADATA_FILE);
}

export function loadMetadataAt(memoryDirectory: string): import("./types.ts").MemoryMetadata {
	const file = metadataPathAt(memoryDirectory);
	if (!fs.existsSync(file)) return { entries: {} };
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as import("./types.ts").MemoryMetadata;
		return parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object"
			? parsed
			: { entries: {} };
	} catch {
		return { entries: {} };
	}
}

export function saveMetadataAt(memoryDirectory: string, metadata: import("./types.ts").MemoryMetadata): void {
	fs.mkdirSync(memoryDirectory, { recursive: true });
	const file = metadataPathAt(memoryDirectory);
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
	fs.renameSync(tmp, file);
}

export function metadataId(type: MemoryType, key: string): string {
	return `${type}:${key}`;
}
export function isExpiredAt(memoryDirectory: string, entry: MemoryIndexEntry, now = Date.now()): boolean {
	const expires = loadMetadataAt(memoryDirectory).entries[metadataId(entry.type, entry.key)]?.expiresAt;
	return Boolean(expires && Number.isFinite(Date.parse(expires)) && Date.parse(expires) <= now);
}

export function sanitizeType(type: string): MemoryType {
	if ((MEMORY_TYPES as readonly string[]).includes(type)) return type as MemoryType;
	return "project";
}

export function topicFileName(type: MemoryType, key: string): string {
	return `${type}-${sanitizeKey(key)}.md`;
}

export function memoryDir(cwd: string): string {
	return path.join(cwd, MEMORY_DIR);
}

export function indexPath(cwd: string): string {
	return path.join(memoryDir(cwd), INDEX_FILE);
}

export function topicPath(cwd: string, type: MemoryType, key: string): string {
	const canonical = path.join(memoryDir(cwd), topicFileName(type, key));
	if (fs.existsSync(canonical)) return canonical;
	// Legacy keys were written without trimming/consolidating unsafe characters.
	const legacy = path.join(memoryDir(cwd), `${type}-${key}.md`);
	return fs.existsSync(legacy) ? legacy : canonical;
}

export function parseIndex(content: string): MemoryIndexEntry[] {
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
			entries.push({
				type: currentType,
				key: entryMatch[1],
				value: entryMatch[2].trim(),
			});
		}
	}
	return entries;
}

export function generateIndexContent(entries: MemoryIndexEntry[]): string {
	const byType: Record<MemoryType, MemoryIndexEntry[]> = {
		user: [],
		feedback: [],
		project: [],
		lesson: [],
	};
	for (const entry of entries) byType[entry.type].push(entry);
	const parts: string[] = ["# Memory Index", ""];
	for (const type of MEMORY_TYPES) {
		const typeEntries = byType[type];
		if (typeEntries.length === 0) continue;
		parts.push(`## ${type}`);
		for (const entry of typeEntries) {
			parts.push(`- [${entry.key}] ${entry.value.replace(/\n/g, " ").slice(0, 100)}`);
		}
		parts.push("");
	}
	return `${parts.join("\n").trim()}\n`;
}

export function loadIndex(cwd: string): MemoryIndexEntry[] {
	const file = indexPath(cwd);
	if (!fs.existsSync(file)) return [];
	return parseIndex(fs.readFileSync(file, "utf8"));
}

/** Load an index file from an absolute MEMORY.md path or a directory that contains MEMORY.md. */
export function loadIndexFile(fileOrDir: string): MemoryIndexEntry[] {
	const file = fileOrDir.endsWith("MEMORY.md") ? fileOrDir : path.join(fileOrDir, "MEMORY.md");
	if (!fs.existsSync(file)) return [];
	return parseIndex(fs.readFileSync(file, "utf8"));
}

export function saveIndex(cwd: string, entries: MemoryIndexEntry[], maxEntries: number): MemoryIndexEntry[] {
	return saveIndexAt(memoryDir(cwd), entries, maxEntries);
}

/**
 * Drop near-duplicate values (same type, high text overlap). Keeps later entries.
 */
export function dedupeEntries(entries: MemoryIndexEntry[]): MemoryIndexEntry[] {
	const out: MemoryIndexEntry[] = [];
	for (const entry of entries) {
		const idx = out.findIndex(
			(existing) =>
				existing.type === entry.type && (existing.key === entry.key || similarValues(existing.value, entry.value)),
		);
		if (idx >= 0) out[idx] = entry;
		else out.push(entry);
	}
	return out;
}

function similarValues(a: string, b: string): boolean {
	const na = a.toLowerCase().replace(/\s+/g, " ").trim();
	const nb = b.toLowerCase().replace(/\s+/g, " ").trim();
	if (!na || !nb) return false;
	if (na === nb) return true;
	// Containment only for reasonably long phrases (avoid "value 1" ~ "value 2")
	const shorter = na.length <= nb.length ? na : nb;
	const longer = na.length <= nb.length ? nb : na;
	if (shorter.length >= 16 && longer.includes(shorter)) return true;
	const ta = new Set(na.split(" ").filter((t) => t.length > 2));
	const tb = new Set(nb.split(" ").filter((t) => t.length > 2));
	if (ta.size < 3 || tb.size < 3) return false;
	let inter = 0;
	for (const t of ta) if (tb.has(t)) inter += 1;
	const union = ta.size + tb.size - inter;
	return union > 0 && inter >= 3 && inter / union >= 0.85;
}

export function upsertEntry(
	entries: MemoryIndexEntry[],
	type: MemoryType,
	key: string,
	value: string,
): MemoryIndexEntry[] {
	const next = entries.filter((entry) => !(entry.type === type && entry.key === key));
	next.push({ type, key, value });
	return next;
}

export function removeEntry(entries: MemoryIndexEntry[], type: MemoryType, key: string): MemoryIndexEntry[] {
	return entries.filter((entry) => !(entry.type === type && entry.key === key));
}

export function saveTopic(cwd: string, type: MemoryType, key: string, body: string): string {
	return saveTopicAt(memoryDir(cwd), type, key, body);
}

/** Save index+topic under an absolute memory directory (e.g. ~/.pi/memory). */
export function saveIndexAt(
	memoryDirectory: string,
	entries: MemoryIndexEntry[],
	maxEntries: number,
): MemoryIndexEntry[] {
	ensureDurabilityLayout(memoryDirectory);
	const previous = loadIndexFile(memoryDirectory);
	const deduped = dedupeEntries(entries);
	// Archive overflow instead of hard-drop (never lose)
	if (deduped.length > maxEntries) {
		const overflow = deduped.slice(0, deduped.length - maxEntries);
		for (const entry of overflow) {
			const body = readTopicAt(memoryDirectory, entry.type, entry.key);
			archiveEntry(memoryDirectory, entry.type, entry.key, entry.value, body, "capacity-overflow");
			const topic = path.join(memoryDirectory, topicFileName(entry.type, entry.key));
			if (fs.existsSync(topic)) fs.unlinkSync(topic);
		}
	}
	const capped = deduped.length > maxEntries ? deduped.slice(-maxEntries) : deduped;
	const indexFile = path.join(memoryDirectory, INDEX_FILE);
	const tmp = `${indexFile}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, generateIndexContent(capped), "utf8");
	fs.renameSync(tmp, indexFile);
	// Journal new/changed saves
	const prevMap = new Map(previous.map((e) => [`${e.type}:${e.key}`, e.value]));
	for (const entry of capped) {
		const id = `${entry.type}:${entry.key}`;
		if (prevMap.get(id) !== entry.value) {
			appendJournal(memoryDirectory, {
				op: "save",
				type: entry.type,
				key: entry.key,
				value: entry.value,
			});
		}
	}
	return capped;
}

export function saveTopicAt(
	memoryDirectory: string,
	type: MemoryType,
	key: string,
	body: string,
	metadata?: { expiresAt?: string; source?: import("./types.ts").MemorySource | string },
): string {
	ensureDurabilityLayout(memoryDirectory);
	const file = path.join(memoryDirectory, topicFileName(type, key));
	const content = `# ${type} / ${key}\n\n${body.trim()}\n\nLast updated: ${new Date().toISOString().slice(0, 10)}\n`;
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, content, "utf8");
	fs.renameSync(tmp, file);
	const allMetadata = loadMetadataAt(memoryDirectory);
	const id = metadataId(type, key);
	const previous = allMetadata.entries[id];
	const now = new Date().toISOString();
	allMetadata.entries[id] = {
		type,
		key,
		createdAt: previous?.createdAt ?? now,
		updatedAt: now,
		expiresAt: metadata?.expiresAt ?? previous?.expiresAt,
		source: metadata?.source ?? previous?.source ?? "manual",
	};
	saveMetadataAt(memoryDirectory, allMetadata);
	appendJournal(memoryDirectory, {
		op: "save",
		type,
		key,
		value: body.slice(0, 160).replace(/\n/g, " "),
		body: body.slice(0, 2000),
	});
	return file;
}

/**
 * Soft-delete: archive then remove from active index/topic/vectors.
 * History remains under archive/ + journal forever.
 */
export function deleteTopicAt(
	memoryDirectory: string,
	type: MemoryType,
	key: string,
	options?: { value?: string; hard?: boolean },
): boolean {
	const file = path.join(memoryDirectory, topicFileName(type, key));
	const body = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : options?.value;
	const value = options?.value ?? body?.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? key;
	if (!options?.hard) {
		archiveEntry(memoryDirectory, type, key, value, body, "delete");
	} else {
		appendJournal(memoryDirectory, { op: "delete", type, key, value, note: "hard-delete" });
	}
	if (fs.existsSync(file)) {
		fs.unlinkSync(file);
		return true;
	}
	return Boolean(body);
}

export function readTopic(cwd: string, type: MemoryType, key: string): string | undefined {
	const file = topicPath(cwd, type, key);
	if (!fs.existsSync(file)) return undefined;
	return fs.readFileSync(file, "utf8");
}

export function readTopicAt(memoryDirectory: string, type: MemoryType, key: string): string | undefined {
	const canonical = path.join(memoryDirectory, topicFileName(type, key));
	const legacy = path.join(memoryDirectory, `${type}-${key}.md`);
	const file = fs.existsSync(canonical) ? canonical : legacy;
	if (!fs.existsSync(file)) return undefined;
	return fs.readFileSync(file, "utf8");
}

export function deleteTopic(cwd: string, type: MemoryType, key: string, value?: string): boolean {
	return deleteTopicAt(memoryDir(cwd), type, key, { value });
}

export function formatSnapshot(entries: MemoryIndexEntry[]): string {
	if (entries.length === 0) {
		return "No long-term memories loaded for this session.";
	}
	const lines = [
		"Frozen long-term memory snapshot for this session.",
		"Do not store information derivable from git/codebase.",
		"",
		generateIndexContent(entries).trim(),
	];
	return lines.join("\n");
}

export function queryEntries(
	entries: MemoryIndexEntry[],
	keyword?: string,
	type?: MemoryType,
	bodyResolver?: (entry: MemoryIndexEntry) => string,
): MemoryIndexEntry[] {
	const typed = type ? entries.filter((entry) => entry.type === type) : entries;
	const needle = keyword?.trim().toLowerCase();
	if (!needle) return typed;
	return typed.filter((entry) => {
		const body = bodyResolver?.(entry) ?? "";
		return (
			entry.key.toLowerCase().includes(needle) ||
			entry.value.toLowerCase().includes(needle) ||
			body.toLowerCase().includes(needle)
		);
	});
}
