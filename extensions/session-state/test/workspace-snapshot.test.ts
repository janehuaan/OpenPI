import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	isGitRepo,
	createSnapshot,
	rollbackToSnapshot,
} from "../src/workspace-snapshot.ts";

describe("Workspace Snapshot & Rollback", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "openpi-snapshot-test-"));
		execFileSync("git", ["init"], { cwd: testDir });
		execFileSync("git", ["config", "user.name", "TestUser"], { cwd: testDir });
		execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: testDir });

		// Initial commit
		writeFileSync(join(testDir, "initial.txt"), "hello world\n");
		execFileSync("git", ["add", "initial.txt"], { cwd: testDir });
		execFileSync("git", ["commit", "-m", "initial commit"], { cwd: testDir });
	});

	afterEach(() => {
		try {
			rmSync(testDir, { recursive: true, force: true });
		} catch {}
	});

	it("identifies git repo correctly", () => {
		expect(isGitRepo(testDir)).toBe(true);
		expect(isGitRepo(tmpdir())).toBe(false);
	});

	it("creates snapshot without modifying git branch or log", () => {
		const headBefore = execFileSync("git", ["rev-parse", "HEAD"], { cwd: testDir, encoding: "utf8" }).trim();

		// Dirty working directory
		writeFileSync(join(testDir, "initial.txt"), "modified line\n");

		const snap = createSnapshot(testDir, "task-test");
		expect(snap).not.toBeNull();
		expect(snap?.id).toBeTruthy();

		// HEAD must NOT have moved
		const headAfter = execFileSync("git", ["rev-parse", "HEAD"], { cwd: testDir, encoding: "utf8" }).trim();
		expect(headAfter).toBe(headBefore);
	});

	it("rolls back modified and untracked files to clean snapshot state", () => {
		// 1. Take snapshot of initial state
		const snap = createSnapshot(testDir, "clean-anchor");
		expect(snap).not.toBeNull();

		// 2. Destructive modifications (dirty file + new untracked junk)
		writeFileSync(join(testDir, "initial.txt"), "COMPLETELY BROKEN CORRUPTED CODE\n");
		writeFileSync(join(testDir, "garbage.js"), "throw new Error();\n");
		expect(readFileSync(join(testDir, "initial.txt"), "utf8")).toContain("COMPLETELY BROKEN");
		expect(existsSync(join(testDir, "garbage.js"))).toBe(true);

		// 3. Rollback
		const res = rollbackToSnapshot(testDir, snap!.id);
		expect(res.restored).toBe(true);

		// 4. Verify physical workspace is back to clean state
		expect(readFileSync(join(testDir, "initial.txt"), "utf8")).toBe("hello world\n");
		expect(existsSync(join(testDir, "garbage.js"))).toBe(false);
	});

	it("preserves pre-existing user untracked files during rollback", () => {
		// User has a pre-existing untracked file (e.g. .env or notes.txt)
		writeFileSync(join(testDir, "user-notes.txt"), "Important personal notes\n");

		// Take snapshot of anchor
		const snap = createSnapshot(testDir, "pre-existing-test");
		expect(snap).not.toBeNull();

		// Agent creates new bad file + modifies code
		writeFileSync(join(testDir, "initial.txt"), "corrupted\n");
		writeFileSync(join(testDir, "agent-new-file.js"), "console.log('bad');\n");

		// Rollback
		const res = rollbackToSnapshot(testDir, snap!.id);
		expect(res.restored).toBe(true);

		// Verified: user-notes.txt survived! agent-new-file.js was purged!
		expect(existsSync(join(testDir, "user-notes.txt"))).toBe(true);
		expect(readFileSync(join(testDir, "user-notes.txt"), "utf8")).toBe("Important personal notes\n");
		expect(existsSync(join(testDir, "agent-new-file.js"))).toBe(false);
		expect(readFileSync(join(testDir, "initial.txt"), "utf8")).toBe("hello world\n");
	});
});
