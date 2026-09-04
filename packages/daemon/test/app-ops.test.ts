/**
 * app-ops coverage: the memory index format, workspace summaries, and the
 * provider/model readers.
 *
 * These moved out of the old Electron `bridge.mjs`, which had no tests at all -
 * it was 1,326 lines inside the asar, so a bug there could only be fixed by
 * reinstalling the .app.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import {
	defaultWorkspace,
	deleteMemory,
	listMemory,
	modelCatalog,
	parseMemoryIndex,
	providerStatus,
	readMemoryTopic,
	recentWorkspaces,
	workspaceSummary,
	writeMemory,
} from "../src/app-ops.ts";

let root: string;
let previousDir: string | undefined;
let previousMemory: string | undefined;

beforeEach(() => {
	previousDir = process.env.OPENPI_DIR;
	previousMemory = process.env.OPENPI_MEMORY_DIR;
	root = mkdtempSync(join(tmpdir(), "openpi-appops-"));
	process.env.OPENPI_DIR = root;
	process.env.OPENPI_MEMORY_DIR = join(root, "global-memory");
});

afterEach(() => {
	if (previousDir === undefined) delete process.env.OPENPI_DIR;
	else process.env.OPENPI_DIR = previousDir;
	if (previousMemory === undefined) delete process.env.OPENPI_MEMORY_DIR;
	else process.env.OPENPI_MEMORY_DIR = previousMemory;
	rmSync(root, { recursive: true, force: true });
});

function makeWorkspace(): string {
	const cwd = join(root, "workspace");
	mkdirSync(cwd, { recursive: true });
	return cwd;
}

function writeModels(providers: Record<string, unknown>): void {
	const dir = join(root, "agent");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "models.json"), JSON.stringify({ providers }), "utf8");
}

test("parseMemoryIndex reads the extension's MEMORY.md format", () => {
	const entries = parseMemoryIndex(`# Memory Index

## user
- [tone] prefers concise Chinese
- [style] no emoji

## project
- [arch] daemon owns sessions
`);
	assert.equal(entries.length, 3);
	assert.deepEqual(entries[0], { type: "user", key: "tone", value: "prefers concise Chinese" });
	assert.equal(entries[2]?.type, "project");
});

test("parseMemoryIndex ignores lines outside a section and malformed items", () => {
	const entries = parseMemoryIndex("- [orphan] no section yet\n## user\nplain text\n- [ok] kept\n");
	assert.deepEqual(entries, [{ type: "user", key: "ok", value: "kept" }]);
});

test("parseMemoryIndex handles an empty document", () => {
	assert.deepEqual(parseMemoryIndex(""), []);
	assert.deepEqual(parseMemoryIndex("# Memory Index\n"), []);
});

test("parseMemoryIndex keeps a CJK key and value intact", () => {
	const entries = parseMemoryIndex("## user\n- [沟通风格] 中文简洁,不要 emoji\n");
	assert.equal(entries[0]?.key, "沟通风格");
	assert.equal(entries[0]?.value, "中文简洁,不要 emoji");
});

test("writeMemory then listMemory round-trips through MEMORY.md", () => {
	const cwd = makeWorkspace();
	writeMemory(cwd, "project", { type: "user", key: "tone", value: "concise" });
	writeMemory(cwd, "project", { type: "project", key: "arch", value: "daemon owns sessions" });

	const entries = listMemory(cwd, "project");
	assert.equal(entries.length, 2);
	assert.ok(entries.some((entry) => entry.key === "tone"));
	assert.ok(entries.some((entry) => entry.key === "arch"));
});

test("writeMemory replaces an entry with the same type and key", () => {
	const cwd = makeWorkspace();
	writeMemory(cwd, "project", { type: "user", key: "tone", value: "first" });
	writeMemory(cwd, "project", { type: "user", key: "tone", value: "second" });

	const entries = listMemory(cwd, "project");
	assert.equal(entries.length, 1);
	assert.equal(entries[0]?.value, "second");
});

test("writeMemory stores the body in a topic file, falling back to the value", () => {
	const cwd = makeWorkspace();
	writeMemory(cwd, "project", { type: "lesson", key: "vitest", value: "run from package root", body: "long detail" });
	writeMemory(cwd, "project", { type: "user", key: "tone", value: "concise" });

	assert.equal(readMemoryTopic(cwd, "project", "lesson", "vitest"), "long detail");
	assert.equal(readMemoryTopic(cwd, "project", "user", "tone"), "concise");
});

test("writeMemory rejects an unknown type and empty fields", () => {
	const cwd = makeWorkspace();
	assert.throws(() => writeMemory(cwd, "project", { type: "nonsense", key: "k", value: "v" }), /Unknown memory type/);
	assert.throws(() => writeMemory(cwd, "project", { type: "user", key: "", value: "v" }), /required/);
	assert.throws(() => writeMemory(cwd, "project", { type: "user", key: "k", value: "  " }), /required/);
});

test("project and global scopes are separate stores", () => {
	const cwd = makeWorkspace();
	writeMemory(cwd, "project", { type: "project", key: "local", value: "project only" });
	writeMemory(cwd, "global", { type: "user", key: "tone", value: "global only" });

	assert.deepEqual(listMemory(cwd, "project").map((entry) => entry.key), ["local"]);
	assert.deepEqual(listMemory(cwd, "global").map((entry) => entry.key), ["tone"]);
});

test("deleteMemory removes the entry and its topic file", () => {
	const cwd = makeWorkspace();
	writeMemory(cwd, "project", { type: "user", key: "tone", value: "concise", body: "detail" });
	const remaining = deleteMemory(cwd, "project", "user", "tone");

	assert.deepEqual(remaining, []);
	assert.equal(listMemory(cwd, "project").length, 0);
	assert.equal(readMemoryTopic(cwd, "project", "user", "tone"), "");
});

test("deleting a missing entry is a no-op", () => {
	const cwd = makeWorkspace();
	assert.deepEqual(deleteMemory(cwd, "project", "user", "never-existed"), []);
});

test("listMemory and readMemoryTopic return empty for a fresh workspace", () => {
	const cwd = makeWorkspace();
	assert.deepEqual(listMemory(cwd, "project"), []);
	assert.equal(readMemoryTopic(cwd, "project", "user", "tone"), "");
});

test("workspaceSummary reports a missing directory rather than throwing", () => {
	const summary = workspaceSummary(join(root, "does-not-exist"));
	assert.equal(summary.exists, false);
	assert.equal(summary.fileCount, 0);
	assert.equal(summary.hasMemory, false);
});

test("workspaceSummary counts visible files and detects memory", () => {
	const cwd = makeWorkspace();
	writeFileSync(join(cwd, "README.md"), "hi", "utf8");
	writeFileSync(join(cwd, ".hidden"), "x", "utf8");
	writeMemory(cwd, "project", { type: "user", key: "tone", value: "concise" });

	const summary = workspaceSummary(cwd);
	assert.equal(summary.exists, true);
	assert.equal(summary.fileCount, 1);
	assert.equal(summary.hasMemory, true);
	assert.equal(summary.memoryCount, 1);
});

test("workspaceSummary reads the git branch from .git/HEAD", () => {
	const cwd = makeWorkspace();
	mkdirSync(join(cwd, ".git"), { recursive: true });
	writeFileSync(join(cwd, ".git", "HEAD"), "ref: refs/heads/feature/desktop\n", "utf8");

	const summary = workspaceSummary(cwd);
	assert.equal(summary.isGitRepo, true);
	assert.equal(summary.branch, "feature/desktop");
});

test("workspaceSummary handles a detached HEAD", () => {
	const cwd = makeWorkspace();
	mkdirSync(join(cwd, ".git"), { recursive: true });
	writeFileSync(join(cwd, ".git", "HEAD"), "b4d0df4a1c2e3f40000000000000000000000000\n", "utf8");
	assert.equal(workspaceSummary(cwd).branch, "b4d0df4a");
});

test("providerStatus reports configuration without leaking keys", () => {
	writeModels({
		anthropic: { apiKey: "sk-secret", baseUrl: "https://api.anthropic.com", models: ["claude-opus-5"] },
		unconfigured: { baseUrl: "https://example.com", models: [] },
	});

	const providers = providerStatus();
	assert.equal(providers.length, 2);
	const anthropic = providers.find((entry) => entry.provider === "anthropic");
	assert.equal(anthropic?.configured, true);
	assert.equal(anthropic?.modelCount, 1);
	assert.equal(providers.find((entry) => entry.provider === "unconfigured")?.configured, false);
	assert.equal(JSON.stringify(providers).includes("sk-secret"), false);
});

test("providerStatus and modelCatalog are empty without a models.json", () => {
	assert.deepEqual(providerStatus(), []);
	assert.deepEqual(modelCatalog(), []);
});

test("modelCatalog returns provider/model refs, which is the form --model needs", () => {
	writeModels({
		anthropic: { apiKey: "k", models: ["claude-opus-5"] },
		"agnes-cn": { apiKey: "k", models: ["agnes-2.5-flash", "agnes-2.0-flash"] },
	});

	const refs = modelCatalog().map((model) => model.ref);
	assert.deepEqual(refs, ["agnes-cn/agnes-2.0-flash", "agnes-cn/agnes-2.5-flash", "anthropic/claude-opus-5"]);
});

test("modelCatalog accepts object-shaped model entries", () => {
	writeModels({ custom: { apiKey: "k", models: [{ id: "my-model" }] } });
	assert.deepEqual(modelCatalog().map((model) => model.ref), ["custom/my-model"]);
});

test("a corrupt models.json yields empty lists rather than throwing", () => {
	const dir = join(root, "agent");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "models.json"), "{ not json", "utf8");
	assert.deepEqual(providerStatus(), []);
	assert.deepEqual(modelCatalog(), []);
});

test("recentWorkspaces dedupes, drops missing paths and keeps order", () => {
	const first = makeWorkspace();
	const second = join(root, "second");
	mkdirSync(second, { recursive: true });

	const recent = recentWorkspaces([first, second, first, join(root, "gone")]);
	assert.deepEqual(recent, [first, second]);
});

test("defaultWorkspace honors OPENPI_WORKSPACE", () => {
	const previous = process.env.OPENPI_WORKSPACE;
	process.env.OPENPI_WORKSPACE = "/tmp/pinned-workspace";
	try {
		assert.equal(defaultWorkspace(), "/tmp/pinned-workspace");
	} finally {
		if (previous === undefined) delete process.env.OPENPI_WORKSPACE;
		else process.env.OPENPI_WORKSPACE = previous;
	}
});
