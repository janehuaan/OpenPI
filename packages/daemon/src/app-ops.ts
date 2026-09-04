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
import { agentDir, piCli } from "./config.ts";

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
	const { stdout, stderr } = await execFileAsync(process.execPath, [piCli(), ...args], {
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir() },
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
