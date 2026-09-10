import { describe, expect, it } from "vitest";
import {
	applyHunksToSource,
	isDiffContent,
	parseDiffHunks,
	parseDiffLines,
} from "../lib/diff";

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

describe("Interactive Chunk-by-Chunk Diff (parseDiffHunks & applyHunksToSource)", () => {
	const multiHunkDiff = `--- a/src/math.ts
+++ b/src/math.ts
@@ -1,4 +1,4 @@
-export function add(a: number, b: number) {
+export function add(a: number, b: number): number {
   return a + b;
 }
@@ -10,4 +10,5 @@
 export function multiply(a: number, b: number) {
-  return a * b;
+  // fast multiply
+  return Math.imul(a, b);
 }`;

	it("parses multiple hunks with individual IDs and statistics", () => {
		const parsed = parseDiffHunks(multiHunkDiff);
		expect(parsed.headers).toHaveLength(2);
		expect(parsed.hunks).toHaveLength(2);

		const hunk1 = parsed.hunks[0];
		expect(hunk1.oldStart).toBe(1);
		expect(hunk1.adds).toBe(1);
		expect(hunk1.dels).toBe(1);
		expect(hunk1.status).toBe("pending");

		const hunk2 = parsed.hunks[1];
		expect(hunk2.oldStart).toBe(10);
		expect(hunk2.adds).toBe(2);
		expect(hunk2.dels).toBe(1);
		expect(hunk2.status).toBe("pending");
	});

	it("selectively applies only accepted hunks and leaves rejected hunks untouched", () => {
		const originalSource = `export function add(a: number, b: number) {
  return a + b;
}

// other lines
// line 6
// line 7
// line 8
// line 9
export function multiply(a: number, b: number) {
  return a * b;
}
`;
		const parsed = parseDiffHunks(multiHunkDiff);

		// Accept hunk 1, reject hunk 2
		parsed.hunks[0].status = "accepted";
		parsed.hunks[1].status = "rejected";

		const { result, appliedCount, rejectedCount } = applyHunksToSource(originalSource, parsed.hunks);
		expect(appliedCount).toBe(1);
		expect(rejectedCount).toBe(1);

		// Hunk 1 should be applied
		expect(result).toContain("export function add(a: number, b: number): number {");

		// Hunk 2 should NOT be applied (original retained)
		expect(result).toContain("return a * b;");
		expect(result).not.toContain("Math.imul");
	});

	it("supports applying user inline-edited lines inside a hunk", () => {
		const originalSource = `export function add(a: number, b: number) {
  return a + b;
}
`;
		const singleDiff = `@@ -1,3 +1,3 @@
 export function add(a: number, b: number) {
-  return a + b;
+  return a + b + 1;
 }`;
		const parsed = parseDiffHunks(singleDiff);
		parsed.hunks[0].status = "accepted";
		// User modified the added lines manually
		parsed.hunks[0].editedLines = [
			"export function add(a: number, b: number) {",
			"  return Number(a) + Number(b);",
			"}",
		];

		const { result } = applyHunksToSource(originalSource, parsed.hunks);
		expect(result).toContain("return Number(a) + Number(b);");
		expect(result).not.toContain("a + b + 1");
	});
});

