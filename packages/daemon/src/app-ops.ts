/**
 * App-level operations: everything the desktop needs that is not tied to a live
 * session.
 *
 * These live in the daemon on purpose. In the old OpenPI they lived in the
 * Electron main process — `bridge.mjs` grew to 1,326 lines of workspace
 * scanning, memory file I/O, models.json editing and provider calls, all of it
 * inside the asar and therefore only updatable by reinstalling the .app. Keeping
 * them here means the main process stays a forwarding layer and this code
 * reloads with a daemon restart.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { agentDir, getDarwinDockSuppressArgs, piCli } from "./config.ts";

const execFileAsync = promisify(execFile);

export interface MemoryEntry {
	type: string;
	key: string;
	value: string;
}

export interface WorkspaceSummary {
	cwd: string;
	exists: boolean;
	isGitRepo: boolean;
	branch?: string;
	fileCount: number;
	hasMemory: boolean;
	memoryCount: number;
}

const MEMORY_TYPES = new Set(["user", "feedback", "project", "lesson"]);

function memoryDir(cwd: string): string {
	return join(cwd, ".pi", "memory");
}

/** Global memory lives beside the isolated agent dir, matching the extension. */
function globalMemoryDir(): string {
	return process.env.OPENPI_MEMORY_DIR ?? join(agentDir(), "..", "memory");
}

function resolveMemoryDir(cwd: string, scope: "project" | "global"): string {
	return scope === "global" ? globalMemoryDir() : memoryDir(cwd);
}

/**
 * Parse `MEMORY.md`, the index the memory extension maintains.
 *
 * Format is `## <type>` sections of `- [key] value` lines. Parsing it here
 * rather than importing the extension keeps the daemon independent of whether
 * that extension is installed.
 */
export function parseMemoryIndex(content: string): MemoryEntry[] {
	const entries: MemoryEntry[] = [];
	let type = "";
	for (const raw of content.split("\n")) {
		const line = raw.trim();
		const heading = line.match(/^##\s+(\w+)/);
		if (heading?.[1]) {
			type = heading[1].toLowerCase();
			continue;
		}
		const item = line.match(/^-\s*\[([^\]]+)\]\s*(.*)$/);
		if (item && type) entries.push({ type, key: item[1] ?? "", value: (item[2] ?? "").trim() });
	}
	return entries;
}

function renderMemoryIndex(entries: MemoryEntry[]): string {
	const byType = new Map<string, MemoryEntry[]>();
	for (const entry of entries) {
		const list = byType.get(entry.type) ?? [];
		list.push(entry);
		byType.set(entry.type, list);
	}
	const lines = ["# Memory Index", ""];
	for (const type of ["user", "feedback", "project", "lesson"]) {
		const list = byType.get(type);
		if (!list || list.length === 0) continue;
		lines.push(`## ${type}`);
		for (const entry of list) lines.push(`- [${entry.key}] ${entry.value}`);
		lines.push("");
	}
	return lines.join("\n");
}

export function listMemory(cwd: string, scope: "project" | "global"): MemoryEntry[] {
	const file = join(resolveMemoryDir(cwd, scope), "MEMORY.md");
	if (!existsSync(file)) return [];
	try {
		return parseMemoryIndex(readFileSync(file, "utf8"));
	} catch {
		return [];
	}
}

export function readMemoryTopic(cwd: string, scope: "project" | "global", type: string, key: string): string {
	const file = join(resolveMemoryDir(cwd, scope), `${type}-${key}.md`);
	if (!existsSync(file)) return "";
	try {
		return readFileSync(file, "utf8");
	} catch {
		return "";
	}
}

export function writeMemory(
	cwd: string,
	scope: "project" | "global",
	entry: MemoryEntry & { body?: string },
): MemoryEntry[] {
	if (!MEMORY_TYPES.has(entry.type)) throw new Error(`Unknown memory type: ${entry.type}`);
	if (!entry.key.trim() || !entry.value.trim()) throw new Error("Memory key and value are required.");

	const dir = resolveMemoryDir(cwd, scope);
	mkdirSync(dir, { recursive: true });
	const entries = listMemory(cwd, scope).filter((item) => !(item.type === entry.type && item.key === entry.key));
	entries.push({ type: entry.type, key: entry.key, value: entry.value });
	atomicWrite(join(dir, "MEMORY.md"), renderMemoryIndex(entries));
	atomicWrite(join(dir, `${entry.type}-${entry.key}.md`), entry.body ?? entry.value);
	return entries;
}

export function deleteMemory(cwd: string, scope: "project" | "global", type: string, key: string): MemoryEntry[] {
	const dir = resolveMemoryDir(cwd, scope);
	const entries = listMemory(cwd, scope).filter((item) => !(item.type === type && item.key === key));
	if (existsSync(join(dir, "MEMORY.md"))) atomicWrite(join(dir, "MEMORY.md"), renderMemoryIndex(entries));
	const topic = join(dir, `${type}-${key}.md`);
	if (existsSync(topic)) unlinkSync(topic);
	return entries;
}

function atomicWrite(file: string, content: string): void {
	mkdirSync(join(file, ".."), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, content, "utf8");
	renameSync(temporary, file);
}

export interface MaintainResult {
	before: number;
	after: number;
	merged: number;
	pruned: number;
}

export interface MaintainMemoryResult {
	project: MaintainResult;
	global: MaintainResult;
}

export interface MemoryMetaResult {
	meta: {
		lastMaintainAt?: string;
		sessionCountSinceMaintain?: number;
		lastLlmExtractAt?: string;
		lastIdleOrganizeAt?: string;
		lastBackupAt?: string;
		lastDigestAt?: string;
	};
	projectCount: number;
	globalCount: number;
	archiveCount: number;
	digestCount: number;
	latestDigest: string | null;
	hasVectors: boolean;
	hasLexicon: boolean;
}

function countFilesInDir(dir: string): number {
	if (!existsSync(dir)) return 0;
	let count = 0;
	try {
		const items = readdirSync(dir, { withFileTypes: true });
		for (const item of items) {
			if (item.isDirectory()) count += countFilesInDir(join(dir, item.name));
			else if (item.isFile() && !item.name.startsWith(".")) count += 1;
		}
	} catch {
		return 0;
	}
	return count;
}

export function memoryMeta(cwd: string): MemoryMetaResult {
	const projDir = resolveMemoryDir(cwd, "project");
	const globDir = resolveMemoryDir(cwd, "global");

	const projEntries = listMemory(cwd, "project");
	const globEntries = listMemory(cwd, "global");

	let meta: Record<string, any> = {};
	const metaFile = join(projDir, "meta.json");
	if (existsSync(metaFile)) {
		try {
			meta = JSON.parse(readFileSync(metaFile, "utf8")) ?? {};
		} catch {}
	}

	const digests = projEntries.filter((e) => e.key.startsWith("session-"));
	const archiveCount = countFilesInDir(join(projDir, "archive")) + countFilesInDir(join(globDir, "archive"));
	const hasVectors = existsSync(join(projDir, "vectors.bin")) || existsSync(join(globDir, "vectors.bin"));
	const hasLexicon = existsSync(join(projDir, "lexicon.bin")) || existsSync(join(globDir, "lexicon.bin"));

	return {
		meta,
		projectCount: projEntries.length,
		globalCount: globEntries.length,
		archiveCount,
		digestCount: digests.length,
		latestDigest: digests.at(-1)?.value ?? null,
		hasVectors,
		hasLexicon,
	};
}

function maintainScope(dir: string, entries: MemoryEntry[]): MaintainResult {
	const before = entries.length;
	if (!existsSync(dir) || before === 0) {
		return { before: 0, after: 0, merged: 0, pruned: 0 };
	}

	const seenKeys = new Map<string, MemoryEntry>();
	let merged = 0;
	for (const entry of entries) {
		const existing = seenKeys.get(entry.key);
		if (existing) {
			merged += 1;
			if (entry.value.length > existing.value.length) {
				seenKeys.set(entry.key, entry);
			}
		} else {
			seenKeys.set(entry.key, entry);
		}
	}

	const kept = Array.from(seenKeys.values());
	const after = kept.length;
	const pruned = Math.max(0, before - after - merged);

	atomicWrite(join(dir, "MEMORY.md"), renderMemoryIndex(kept));

	const metaFile = join(dir, "meta.json");
	let meta: Record<string, any> = {};
	if (existsSync(metaFile)) {
		try {
			meta = JSON.parse(readFileSync(metaFile, "utf8")) ?? {};
		} catch {}
	}
	meta.lastMaintainAt = new Date().toISOString();
	atomicWrite(metaFile, JSON.stringify(meta, null, 2) + "\n");

	return { before, after, merged, pruned };
}

export function maintainMemory(cwd: string): MaintainMemoryResult {
	const projDir = resolveMemoryDir(cwd, "project");
	const globDir = resolveMemoryDir(cwd, "global");

	const project = maintainScope(projDir, listMemory(cwd, "project"));
	const global = maintainScope(globDir, listMemory(cwd, "global"));

	return { project, global };
}

export interface ArchivedMemoryRecord {
	type: string;
	key: string;
	value: string;
	body?: string;
	reason?: string;
	archivedAt: string;
	scope: "project" | "global";
}

export function listArchivedMemory(cwd: string, scope: "project" | "global"): ArchivedMemoryRecord[] {
	const dir = resolveMemoryDir(cwd, scope);
	const archiveRoot = join(dir, "archive");
	if (!existsSync(archiveRoot)) return [];
	const results: ArchivedMemoryRecord[] = [];
	try {
		const days = readdirSync(archiveRoot, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name)
			.sort((a, b) => b.localeCompare(a));

		for (const day of days) {
			const dayDir = join(archiveRoot, day);
			let files: string[] = [];
			try {
				files = readdirSync(dayDir).filter((f) => f.endsWith(".json"));
			} catch {
				continue;
			}
			for (const file of files) {
				try {
					const meta = JSON.parse(readFileSync(join(dayDir, file), "utf8"));
					const mdFile = join(dayDir, file.replace(/\.json$/, ".md"));
					const body = existsSync(mdFile) ? readFileSync(mdFile, "utf8") : meta.value;
					results.push({
						type: meta.type || "context",
						key: meta.key || file.replace(/\.json$/, ""),
						value: meta.value || "",
						body,
						reason: meta.reason || "superseded",
						archivedAt: meta.at || day,
						scope,
					});
				} catch {}
			}
		}
	} catch {}
	return results;
}

export function restoreArchivedMemory(
	cwd: string,
	scope: "project" | "global",
	entry: { type: string; key: string; value: string; body?: string },
): MemoryEntry[] {
	return writeMemory(cwd, scope, {
		type: entry.type as any,
		key: entry.key,
		value: entry.value,
		body: entry.body,
	});
}

/**
 * Summarize a workspace for the sidebar. Deliberately shallow: this runs on
 * every workspace switch, and walking a large tree would stall the UI.
 */
export function workspaceSummary(cwd: string): WorkspaceSummary {
	if (!existsSync(cwd)) {
		return { cwd, exists: false, isGitRepo: false, fileCount: 0, hasMemory: false, memoryCount: 0 };
	}
	let fileCount = 0;
	try {
		fileCount = readdirSync(cwd).filter((name) => !name.startsWith(".")).length;
	} catch {
		// Unreadable directory: report zero rather than failing the switch.
	}
	const memory = listMemory(cwd, "project");
	return {
		cwd,
		exists: true,
		isGitRepo: existsSync(join(cwd, ".git")),
		branch: gitBranch(cwd),
		fileCount,
		hasMemory: memory.length > 0,
		memoryCount: memory.length,
	};
}

function gitBranch(cwd: string): string | undefined {
	const head = join(cwd, ".git", "HEAD");
	if (!existsSync(head)) return undefined;
	try {
		const content = readFileSync(head, "utf8").trim();
		const match = content.match(/^ref: refs\/heads\/(.+)$/);
		return match?.[1] ?? content.slice(0, 8);
	} catch {
		return undefined;
	}
}

export interface ProviderStatus {
	provider: string;
	configured: boolean;
	baseUrl?: string;
	modelCount: number;
}

/**
 * Provider list from the isolated agent dir's models.json.
 *
 * Reads the file rather than shelling out to `pi`: this is polled by the model
 * picker, and a subprocess per poll is wasteful. Never returns key material —
 * only whether a key is present.
 */
export function providerStatus(): ProviderStatus[] {
	const file = join(agentDir(), "models.json");
	if (!existsSync(file)) return [];
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as {
			providers?: Record<string, { apiKey?: string; baseUrl?: string; models?: unknown }>;
		};
		return Object.entries(parsed.providers ?? {}).map(([provider, config]) => ({
			provider,
			configured: Boolean(config.apiKey),
			baseUrl: config.baseUrl,
			modelCount: Array.isArray(config.models)
				? config.models.length
				: Object.keys((config.models as object) ?? {}).length,
		}));
	} catch {
		return [];
	}
}

export interface ModelOption {
	provider: string;
	modelId: string;
	/** `provider/modelId`, the form the CLI's --model flag needs. */
	ref: string;
}

export function modelCatalog(): ModelOption[] {
	const file = join(agentDir(), "models.json");
	if (!existsSync(file)) return [];
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as {
			providers?: Record<string, { models?: unknown }>;
		};
		const out: ModelOption[] = [];
		for (const [provider, config] of Object.entries(parsed.providers ?? {})) {
			const models = Array.isArray(config.models)
				? config.models
				: Object.keys((config.models as object) ?? {});
			for (const model of models) {
				const modelId = typeof model === "string" ? model : ((model as { id?: string }).id ?? "");
				if (modelId) out.push({ provider, modelId, ref: `${provider}/${modelId}` });
			}
		}
		return out.sort((a, b) => a.ref.localeCompare(b.ref));
	} catch {
		return [];
	}
}

/** Run a `pi` subcommand in the isolated agent dir. Used for auth flows. */
export async function runPiCommand(args: string[], timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
	const { stdout, stderr } = await execFileAsync(process.execPath, [...getDarwinDockSuppressArgs(), piCli(), ...args], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", PI_CODING_AGENT_DIR: agentDir() },
		timeout: timeoutMs,
		maxBuffer: 4 * 1024 * 1024,
	});
	return { stdout, stderr };
}

export function defaultWorkspace(): string {
	return process.env.OPENPI_WORKSPACE ?? homedir();
}

/** Recently used workspaces, newest first, from the daemon's session records. */
export function recentWorkspaces(cwds: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const cwd of cwds) {
		if (seen.has(cwd)) continue;
		seen.add(cwd);
		if (existsSync(cwd) && statSync(cwd).isDirectory()) out.push(cwd);
	}
	return out.slice(0, 12);
}
