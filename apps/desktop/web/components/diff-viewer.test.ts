import { describe, expect, it } from "vitest";
import { isDiffContent, parseDiffLines } from "../lib/diff";

describe("isDiffContent", () => {
	it("detects diff hunk headers", () => {
		const hunk = "@@ -1,5 +1,6 @@\n const a = 1;\n+const b = 2;";
		expect(isDiffContent(hunk)).toBe(true);
	});

	it("detects git diff headers", () => {
		const gitDiff = "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts";
		expect(isDiffContent(gitDiff)).toBe(true);
	});

	it("detects multi-line patch blocks with added and removed lines", () => {
		const patch = "--- old.txt\n+++ new.txt\n-old line\n+new line";
		expect(isDiffContent(patch)).toBe(true);
	});

	it("returns false for plain non-diff text", () => {
		expect(isDiffContent("All 46 tests passed successfully.")).toBe(false);
		expect(isDiffContent("function hello() { return 'world'; }")).toBe(false);
		expect(isDiffContent("")).toBe(false);
	});
});

describe("parseDiffLines", () => {
	it("correctly parses hunks, additions, deletions, and context lines with line numbering", () => {
		const diffText = `@@ -10,3 +10,4 @@
 context line 1
-removed line
+added line 1
+added line 2
 context line 2`;

		const { lines, adds, dels } = parseDiffLines(diffText);
		expect(lines).toHaveLength(6);
		expect(adds).toBe(2);
		expect(dels).toBe(1);

		// Line 0: Hunk header
		expect(lines[0]?.type).toBe("hunk");
		expect(lines[0]?.content).toBe("@@ -10,3 +10,4 @@");

		// Line 1: Context line
		expect(lines[1]?.type).toBe("ctx");
		expect(lines[1]?.content).toBe("context line 1");
		expect(lines[1]?.oldLineNo).toBe(10);
		expect(lines[1]?.newLineNo).toBe(10);

		// Line 2: Removed line
		expect(lines[2]?.type).toBe("del");
		expect(lines[2]?.content).toBe("removed line");
		expect(lines[2]?.oldLineNo).toBe(11);
		expect(lines[2]?.newLineNo).toBeUndefined();

		// Line 3: Added line 1
		expect(lines[3]?.type).toBe("add");
		expect(lines[3]?.content).toBe("added line 1");
		expect(lines[3]?.oldLineNo).toBeUndefined();
		expect(lines[3]?.newLineNo).toBe(11);

		// Line 4: Added line 2
		expect(lines[4]?.type).toBe("add");
		expect(lines[4]?.content).toBe("added line 2");
		expect(lines[4]?.newLineNo).toBe(12);

		// Line 5: Context line 2
		expect(lines[5]?.type).toBe("ctx");
		expect(lines[5]?.content).toBe("context line 2");
		expect(lines[5]?.oldLineNo).toBe(12);
		expect(lines[5]?.newLineNo).toBe(13);
	});
});
