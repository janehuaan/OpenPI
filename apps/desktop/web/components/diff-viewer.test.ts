import { describe, expect, it } from "vitest";
import {
	applyHunksToSource,
	buildSideBySideRows,
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

describe("Side-by-Side (Split) Diff Alignment (buildSideBySideRows)", () => {
	it("aligns balanced changes and synchronizes context lines", () => {
		const diffText = `@@ -10,3 +10,3 @@
 context top
-old line
+new line
 context bottom`;

		const parsed = parseDiffHunks(diffText);
		expect(parsed.hunks).toHaveLength(1);
		const rows = buildSideBySideRows(parsed.hunks[0]);

		expect(rows).toHaveLength(3);
		// Row 0: Context line
		expect(rows[0].left).toEqual({ type: "ctx", content: "context top", lineNo: 10 });
		expect(rows[0].right).toEqual({ type: "ctx", content: "context top", lineNo: 10 });

		// Row 1: Modified line (del on left, add on right)
		expect(rows[1].left).toEqual({ type: "del", content: "old line", lineNo: 11 });
		expect(rows[1].right).toEqual({ type: "add", content: "new line", lineNo: 11 });

		// Row 2: Context bottom
		expect(rows[2].left).toEqual({ type: "ctx", content: "context bottom", lineNo: 12 });
		expect(rows[2].right).toEqual({ type: "ctx", content: "context bottom", lineNo: 12 });
	});

	it("aligns pure additions with empty cells on the left", () => {
		const diffText = `@@ -5,1 +5,3 @@
 context
+new line 1
+new line 2`;

		const parsed = parseDiffHunks(diffText);
		const rows = buildSideBySideRows(parsed.hunks[0]);

		expect(rows).toHaveLength(3);
		// Row 0: Context
		expect(rows[0].left.type).toBe("ctx");
		expect(rows[0].right.type).toBe("ctx");

		// Row 1: First addition
		expect(rows[1].left.type).toBe("empty");
		expect(rows[1].right).toEqual({ type: "add", content: "new line 1", lineNo: 6 });

		// Row 2: Second addition
		expect(rows[2].left.type).toBe("empty");
		expect(rows[2].right).toEqual({ type: "add", content: "new line 2", lineNo: 7 });
	});

	it("aligns pure deletions with empty cells on the right", () => {
		const diffText = `@@ -20,3 +20,1 @@
 context
-deleted line 1
-deleted line 2`;

		const parsed = parseDiffHunks(diffText);
		const rows = buildSideBySideRows(parsed.hunks[0]);

		expect(rows).toHaveLength(3);
		expect(rows[0].left.type).toBe("ctx");
		expect(rows[0].right.type).toBe("ctx");

		expect(rows[1].left).toEqual({ type: "del", content: "deleted line 1", lineNo: 21 });
		expect(rows[1].right.type).toBe("empty");

		expect(rows[2].left).toEqual({ type: "del", content: "deleted line 2", lineNo: 22 });
		expect(rows[2].right.type).toBe("empty");
	});

	it("handles unbalanced changes (e.g. 1 deletion replaced by 3 additions)", () => {
		const diffText = `@@ -1,2 +1,4 @@
-const x = 1;
+const x = 1;
+const y = 2;
+const z = 3;
 const keep = true;`;

		const parsed = parseDiffHunks(diffText);
		const rows = buildSideBySideRows(parsed.hunks[0]);

		// 3 rows for the changes + 1 context row = 4 rows
		expect(rows).toHaveLength(4);

		// First change row: 1 del vs 1st add
		expect(rows[0].left).toEqual({ type: "del", content: "const x = 1;", lineNo: 1 });
		expect(rows[0].right).toEqual({ type: "add", content: "const x = 1;", lineNo: 1 });

		// Second change row: empty on left vs 2nd add
		expect(rows[1].left.type).toBe("empty");
		expect(rows[1].right).toEqual({ type: "add", content: "const y = 2;", lineNo: 2 });

		// Third change row: empty on left vs 3rd add
		expect(rows[2].left.type).toBe("empty");
		expect(rows[2].right).toEqual({ type: "add", content: "const z = 3;", lineNo: 3 });

		// Fourth row: context
		expect(rows[3].left).toEqual({ type: "ctx", content: "const keep = true;", lineNo: 2 });
		expect(rows[3].right).toEqual({ type: "ctx", content: "const keep = true;", lineNo: 4 });
	});
});


