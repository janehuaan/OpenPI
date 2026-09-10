import assert from "node:assert/strict";
import test from "node:test";
import { applyHunksToSource, parseDiffHunks } from "@openpi/shared";

test("parseDiffHunks parses hunks with boundary metadata and diff lines", () => {
	const diff = `@@ -1,3 +1,4 @@
 line 1
-line 2
+line 2 updated
+line 2.5 added
 line 3`;

	const { hunks, totalAdds, totalDels } = parseDiffHunks(diff);
	assert.equal(hunks.length, 1);
	assert.equal(hunks[0].oldStart, 1);
	assert.equal(hunks[0].oldCount, 3);
	assert.equal(hunks[0].newStart, 1);
	assert.equal(hunks[0].newCount, 4);
	assert.equal(hunks[0].status, "pending");
	assert.equal(hunks[0].lines.length, 6); // header + 5 content lines
	assert.equal(totalAdds, 2);
	assert.equal(totalDels, 1);
});

test("applyHunksToSource applies accepted hunks surgically", () => {
	const source = `function add(a, b) {
  return a + b;
}`;

	const diff = `@@ -1,3 +1,4 @@
 function add(a, b) {
+  // add two numbers
   return a + b;
 }`;

	const { hunks } = parseDiffHunks(diff);
	hunks[0].status = "accepted";
	const { result, appliedCount, rejectedCount } = applyHunksToSource(source, hunks);
	assert.equal(appliedCount, 1);
	assert.equal(rejectedCount, 0);
	assert.equal(result.includes("// add two numbers"), true);
	assert.equal(result.includes("function add"), true);
});

test("applyHunksToSource leaves rejected hunks unmodified", () => {
	const source = `const x = 10;
const y = 20;`;

	const diff = `@@ -1,2 +1,2 @@
 const x = 10;
-const y = 20;
+const y = 999;`;

	const { hunks } = parseDiffHunks(diff);
	hunks[0].status = "rejected";
	const { result, appliedCount, rejectedCount } = applyHunksToSource(source, hunks);
	assert.equal(appliedCount, 0);
	assert.equal(rejectedCount, 1);
	assert.equal(result, source);
});
