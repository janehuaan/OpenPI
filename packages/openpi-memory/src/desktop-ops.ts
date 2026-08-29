/**
 * CLI used by Electron main (node --experimental-strip-types) so memory I/O
 * shares openpi-memory store logic instead of a parallel bridge implementation.
 *
 * Usage:
 *   desktop-ops list <cwd> [scope=project|global]
 *   desktop-ops write <cwd> <type> <key> <valueJson> [bodyJson] [scope]
 *   desktop-ops delete <cwd> <type> <key> [scope]
 *   desktop-ops meta <cwd>
 *   desktop-ops maintain <cwd>
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listArchiveCount } from "./durability.ts";
import { loadMeta, maintainMemoryDirectory, maintainMemoryIndex } from "./maintain.ts";
import { LEXICON_BIN } from "./rank.ts";

import {
	deleteTopic,
	deleteTopicAt,
	loadIndex,
	loadIndexFile,
	memoryDir,
	removeEntry,
	sanitizeKey,
	sanitizeType,
	saveIndex,
	saveIndexAt,
	saveTopic,
	saveTopicAt,
	upsertEntry,
} from "./store.ts";
import { DEFAULT_MEMORY_CONFIG } from "./types.ts";
import { VECTORS_BIN } from "./vectors.ts";

const [op, cwd, ...rest] = process.argv.slice(2);
if (!op || !cwd) {
	console.error("usage: desktop-ops <list|write|delete|meta|maintain> <cwd> ...");
	process.exit(2);
}

const MAX = 500;
const globalDir = path.join(os.homedir(), ".pi", "memory");

try {
	if (op === "list") {
		const scope = (rest[0] ?? "project").toLowerCase() === "global" ? "global" : "project";
		const entries = scope === "global" ? loadIndexFile(globalDir) : loadIndex(cwd);
		const lines = entries.map((entry) => `[${entry.type}] ${entry.key}: ${entry.value}`);
		process.stdout.write(`${JSON.stringify({ ok: true, lines, scope })}\n`);
		process.exit(0);
	}
	if (op === "meta") {
		const meta = loadMeta(cwd);
		const projectEntries = loadIndex(cwd);
		const globalEntries = loadIndexFile(globalDir);
		const projectDir = memoryDir(cwd);
		const digests = projectEntries.filter((e) => e.type === "project" && e.key.startsWith("session-"));
		const archiveCount = listArchiveCount(projectDir);
		const hasVectors =
			fs.existsSync(path.join(projectDir, VECTORS_BIN)) || fs.existsSync(path.join(globalDir, VECTORS_BIN));
		const hasLexicon =
			fs.existsSync(path.join(projectDir, LEXICON_BIN)) || fs.existsSync(path.join(globalDir, LEXICON_BIN));
		process.stdout.write(
			`${JSON.stringify({
				ok: true,
				meta,
				projectCount: projectEntries.length,
				globalCount: globalEntries.length,
				archiveCount,
				digestCount: digests.length,
				latestDigest: digests.at(-1)?.value ?? null,
				hasVectors,
				hasLexicon,
				features: {
					proactiveInject: DEFAULT_MEMORY_CONFIG.proactiveInject,
					softExtractEveryTurn: DEFAULT_MEMORY_CONFIG.softExtractEveryTurn,
					autoSessionDigest: DEFAULT_MEMORY_CONFIG.autoSessionDigest,
					promoteUserToGlobal: DEFAULT_MEMORY_CONFIG.promoteUserToGlobal,
					searchArchive: DEFAULT_MEMORY_CONFIG.searchArchive,
				},
			})}\n`,
		);
		process.exit(0);
	}
	if (op === "maintain") {
		const project = maintainMemoryIndex(cwd, { ...DEFAULT_MEMORY_CONFIG, maxIndexEntries: MAX });
		const global = maintainMemoryDirectory(globalDir, { ...DEFAULT_MEMORY_CONFIG, maxIndexEntries: MAX });
		process.stdout.write(`${JSON.stringify({ ok: true, project, global })}\n`);
		process.exit(0);
	}
	if (op === "write") {
		const [typeRaw, keyRaw, valueJson, bodyJson, scopeRaw] = rest;
		const scope = (scopeRaw ?? "project").toLowerCase() === "global" ? "global" : "project";
		const type = sanitizeType(typeRaw ?? "project");
		const key = sanitizeKey(keyRaw ?? "");
		const value = JSON.parse(valueJson ?? '""') as string;
		const body = bodyJson !== undefined ? (JSON.parse(bodyJson) as string) : value;
		if (!key || !value?.trim()) throw new Error("Memory key and value are required");
		if (scope === "global") {
			const next = upsertEntry(loadIndexFile(globalDir), type, key, value.trim());
			saveIndexAt(globalDir, next, MAX);
			saveTopicAt(globalDir, type, key, (body ?? value).trim());
		} else {
			const next = upsertEntry(loadIndex(cwd), type, key, value.trim());
			saveIndex(cwd, next, MAX);
			saveTopic(cwd, type, key, (body ?? value).trim());
		}
		process.stdout.write(`${JSON.stringify({ ok: true, scope })}\n`);
		process.exit(0);
	}
	if (op === "delete") {
		const [typeRaw, keyRaw, scopeRaw] = rest;
		const scope = (scopeRaw ?? "project").toLowerCase() === "global" ? "global" : "project";
		const type = sanitizeType(typeRaw ?? "project");
		const key = sanitizeKey(keyRaw ?? "");
		if (scope === "global") {
			const next = removeEntry(loadIndexFile(globalDir), type, key);
			saveIndexAt(globalDir, next, MAX);
			deleteTopicAt(globalDir, type, key);
		} else {
			const next = removeEntry(loadIndex(cwd), type, key);
			saveIndex(cwd, next, MAX);
			deleteTopic(cwd, type, key);
		}
		process.stdout.write(`${JSON.stringify({ ok: true, scope })}\n`);
		process.exit(0);
	}
	throw new Error(`Unknown op: ${op}`);
} catch (error) {
	process.stdout.write(
		`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
	);
	process.exit(1);
}
