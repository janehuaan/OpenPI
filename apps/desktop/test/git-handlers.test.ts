import { describe, expect, it } from "vitest";
import { parseGitStatus } from "../electron/handlers";
import { matchKeybinding } from "../web/lib/keybindings";
import { LOCAL_SLASH } from "../web/lib/helpers";

describe("Git Status Parser (parseGitStatus)", () => {
	it("parses clean repository status on branch with remote tracking", () => {
		const raw = `## main...origin/main\n`;
		const result = parseGitStatus(raw);
		expect(result.branch).toBe("main");
		expect(result.upstream).toBe("origin/main");
		expect(result.ahead).toBe(0);
		expect(result.behind).toBe(0);
		expect(result.files).toHaveLength(0);
	});

	it("parses ahead and behind commit counts", () => {
		const raw = `## feature/git-control...origin/feature/git-control [ahead 3, behind 1]\n`;
		const result = parseGitStatus(raw);
		expect(result.branch).toBe("feature/git-control");
		expect(result.upstream).toBe("origin/feature/git-control");
		expect(result.ahead).toBe(3);
		expect(result.behind).toBe(1);
	});

	it("parses untracked files", () => {
		const raw = `## master\n?? newfile.txt\n?? src/untracked.ts\n`;
		const result = parseGitStatus(raw);
		expect(result.branch).toBe("master");
		expect(result.files).toHaveLength(2);
		expect(result.files[0]).toEqual({
			path: "newfile.txt",
			status: "untracked",
			staged: false,
		});
		expect(result.files[1]).toEqual({
			path: "src/untracked.ts",
			status: "untracked",
			staged: false,
		});
	});

	it("parses unstaged modifications and deletions", () => {
		const raw = `## main\n M apps/desktop/web/App.tsx\n D docs/old.md\n`;
		const result = parseGitStatus(raw);
		expect(result.files).toHaveLength(2);
		expect(result.files[0]).toEqual({
			path: "apps/desktop/web/App.tsx",
			status: "modified",
			staged: false,
		});
		expect(result.files[1]).toEqual({
			path: "docs/old.md",
			status: "deleted",
			staged: false,
		});
	});

	it("parses staged additions, modifications, and renames", () => {
		const raw = `## main\nA  apps/desktop/new-component.tsx\nM  package.json\nR  old-name.ts -> new-name.ts\n`;
		const result = parseGitStatus(raw);
		expect(result.files).toHaveLength(3);
		expect(result.files[0]).toEqual({
			path: "apps/desktop/new-component.tsx",
			status: "added",
			staged: true,
			oldPath: undefined,
		});
		expect(result.files[1]).toEqual({
			path: "package.json",
			status: "modified",
			staged: true,
			oldPath: undefined,
		});
		expect(result.files[2]).toEqual({
			path: "new-name.ts",
			status: "renamed",
			staged: true,
			oldPath: "old-name.ts",
		});
	});

	it("parses both staged and unstaged changes on the same file (MM status)", () => {
		const raw = `## main\nMM src/dual-modified.ts\n`;
		const result = parseGitStatus(raw);
		expect(result.files).toHaveLength(2);
		expect(result.files[0]).toEqual({
			path: "src/dual-modified.ts",
			status: "modified",
			staged: true,
			oldPath: undefined,
		});
		expect(result.files[1]).toEqual({
			path: "src/dual-modified.ts",
			status: "modified",
			staged: false,
		});
	});

	it("parses unmerged conflicted files (UU, AA, UD, DU)", () => {
		const raw = `## main\nUU src/conflict-both.ts\nAA src/conflict-added.ts\nUD src/conflict-deleted.ts\n`;
		const result = parseGitStatus(raw);
		expect(result.files).toHaveLength(3);
		expect(result.files[0]).toEqual({
			path: "src/conflict-both.ts",
			status: "conflicted",
			staged: false,
		});
		expect(result.files[1]).toEqual({
			path: "src/conflict-added.ts",
			status: "conflicted",
			staged: false,
		});
		expect(result.files[2]).toEqual({
			path: "src/conflict-deleted.ts",
			status: "conflicted",
			staged: false,
		});
	});
});


describe("Git Keybinding Integration", () => {
	it("resolves Cmd+Shift+G / Ctrl+Shift+G to toggle_git action", () => {
		const macEvent = {
			metaKey: true,
			ctrlKey: false,
			shiftKey: true,
			altKey: false,
			key: "G",
		};
		expect(matchKeybinding(macEvent)).toBe("toggle_git");

		const linuxEvent = {
			metaKey: false,
			ctrlKey: true,
			shiftKey: true,
			altKey: false,
			key: "g",
		};
		expect(matchKeybinding(linuxEvent)).toBe("toggle_git");
	});
});

describe("Git Slash Command Integration", () => {
	it("contains git command in LOCAL_SLASH", () => {
		const gitCmd = LOCAL_SLASH.find((cmd) => cmd.id === "git");
		expect(gitCmd).toBeDefined();
		expect(gitCmd?.label).toBe("/git");
		expect(gitCmd?.kind).toBe("nav");
		expect(gitCmd?.match.test("/git")).toBe(true);
		expect(gitCmd?.match.test("/版本管理")).toBe(true);
		expect(gitCmd?.match.test("/分支")).toBe(true);
		expect(gitCmd?.match.test("/diff")).toBe(true);
	});
});
