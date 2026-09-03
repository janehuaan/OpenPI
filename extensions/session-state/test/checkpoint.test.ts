/**
 * checkpoint.ts coverage.
 *
 * The JSON extraction is the risky part: models wrap the object in prose or
 * fences however they like, and a parse failure must degrade to "no checkpoint"
 * rather than corrupt one. These tests pin the shapes seen in practice.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	checkpointFromDraft,
	checkpointPath,
	compactCheckpoint,
	type ContextCheckpoint,
	deleteCheckpoint,
	formatCheckpoint,
	loadCheckpoint,
	parseCheckpointDraft,
	saveCheckpoint,
} from "../src/checkpoint.ts";

const temporaryDirs: string[] = [];

function makeCwd(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-checkpoint-"));
	temporaryDirs.push(dir);
	return dir;
}

const FULL_DRAFT = {
	goal: "port the memory extension",
	done: ["copied vectors.ts", "added 100 tests"],
	inProgress: ["wiring session-state"],
	nextSteps: ["port the tools extension", "build the desktop shell"],
	decisions: [{ what: "drop the Rust backend", why: "its binary never shipped" }],
	issues: [{ message: "provider 401 in the isolated agent dir", recovered: true, tool: "pi" }],
	criticalContext: ["extensions/memory/src/vectors.ts", "VECTOR_DIM = 384"],
	constraints: ["desktop only", "no upstream patches"],
};

function fullCheckpoint(sessionId = "s1"): ContextCheckpoint {
	return checkpointFromDraft(sessionId, FULL_DRAFT, { summary: "raw summary text" });
}

afterEach(() => {
	while (temporaryDirs.length > 0) {
		const dir = temporaryDirs.pop();
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("parseCheckpointDraft", () => {
	it("parses a bare JSON object", () => {
		expect(parseCheckpointDraft(JSON.stringify(FULL_DRAFT))?.goal).toBe("port the memory extension");
	});

	it("finds the object inside markdown fences", () => {
		const wrapped = `Here is the checkpoint:\n\`\`\`json\n${JSON.stringify(FULL_DRAFT)}\n\`\`\`\nDone.`;
		expect(parseCheckpointDraft(wrapped)?.goal).toBe("port the memory extension");
	});

	it("finds the object when prose surrounds it", () => {
		const wrapped = `I analyzed the conversation. ${JSON.stringify(FULL_DRAFT)} That is the summary.`;
		expect(parseCheckpointDraft(wrapped)?.goal).toBe("port the memory extension");
	});

	it("handles braces inside string values", () => {
		const draft = { goal: 'fix the {broken} template literal', done: [] };
		expect(parseCheckpointDraft(JSON.stringify(draft))?.goal).toBe("fix the {broken} template literal");
	});

	it("handles escaped quotes inside string values", () => {
		const draft = { goal: 'the model said "no"', done: [] };
		expect(parseCheckpointDraft(JSON.stringify(draft))?.goal).toBe('the model said "no"');
	});

	it("keeps nested objects intact", () => {
		const parsed = parseCheckpointDraft(JSON.stringify(FULL_DRAFT));
		expect(Array.isArray(parsed?.decisions)).toBe(true);
		expect((parsed?.decisions as Array<{ what: string }>)[0]?.what).toBe("drop the Rust backend");
	});

	it("returns undefined when there is no JSON at all", () => {
		expect(parseCheckpointDraft("The conversation was about porting code.")).toBeUndefined();
		expect(parseCheckpointDraft("")).toBeUndefined();
	});

	it("returns undefined for an unterminated object", () => {
		expect(parseCheckpointDraft('{"goal": "half a checkpoint"')).toBeUndefined();
	});

	it("returns undefined for a JSON array", () => {
		expect(parseCheckpointDraft("[1, 2, 3]")).toBeUndefined();
	});
});

describe("checkpointFromDraft", () => {
	it("carries every field across", () => {
		const checkpoint = fullCheckpoint();
		expect(checkpoint.goal).toBe("port the memory extension");
		expect(checkpoint.done).toHaveLength(2);
		expect(checkpoint.decisions[0]?.why).toBe("its binary never shipped");
		expect(checkpoint.issues[0]?.recovered).toBe(true);
		expect(checkpoint.constraints).toContain("desktop only");
	});

	it("drops non-string list items instead of failing", () => {
		const checkpoint = checkpointFromDraft("s1", {
			goal: "g",
			done: ["real", 42, null, { nested: true }, "also real"],
		});
		expect(checkpoint.done).toEqual(["real", "also real"]);
	});

	it("drops decisions with no 'what' and issues with no 'message'", () => {
		const checkpoint = checkpointFromDraft("s1", {
			decisions: [{ why: "orphan rationale" }, { what: "kept", why: "reason" }],
			issues: [{ recovered: false }, { message: "kept issue" }],
		});
		expect(checkpoint.decisions).toHaveLength(1);
		expect(checkpoint.issues).toHaveLength(1);
	});

	it("treats a missing recovered flag as unresolved", () => {
		const checkpoint = checkpointFromDraft("s1", { issues: [{ message: "still broken" }] });
		expect(checkpoint.issues[0]?.recovered).toBe(false);
	});

	it("normalizes a wholly empty draft to empty arrays, never null", () => {
		const checkpoint = checkpointFromDraft("s1", {});
		expect(checkpoint.goal).toBe("");
		expect(checkpoint.done).toEqual([]);
		expect(checkpoint.issues).toEqual([]);
		expect(checkpoint.constraints).toEqual([]);
	});

	it("keeps the previous createdAt and goal when updating", () => {
		const previous = fullCheckpoint();
		const updated = checkpointFromDraft("s1", { done: ["more work"] }, { previous });
		expect(updated.createdAt).toBe(previous.createdAt);
		expect(updated.goal).toBe(previous.goal);
	});

	it("truncates a very long summary", () => {
		const checkpoint = checkpointFromDraft("s1", FULL_DRAFT, { summary: "x".repeat(9000) });
		expect(checkpoint.historySummary?.length).toBe(4000);
	});
});

describe("save/load", () => {
	it("round-trips through disk", () => {
		const cwd = makeCwd();
		saveCheckpoint(cwd, fullCheckpoint());
		const loaded = loadCheckpoint(cwd, "s1");
		expect(loaded?.goal).toBe("port the memory extension");
		expect(loaded?.nextSteps).toHaveLength(2);
	});

	it("scopes files per session", () => {
		const cwd = makeCwd();
		saveCheckpoint(cwd, fullCheckpoint("a"));
		expect(loadCheckpoint(cwd, "b")).toBeUndefined();
	});

	it("returns undefined for missing, corrupt, and future-version files", () => {
		const cwd = makeCwd();
		expect(loadCheckpoint(cwd, "missing")).toBeUndefined();

		const file = checkpointPath(cwd, "corrupt");
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, "not json at all", "utf8");
		expect(loadCheckpoint(cwd, "corrupt")).toBeUndefined();

		fs.writeFileSync(checkpointPath(cwd, "future"), JSON.stringify({ version: 99 }), "utf8");
		expect(loadCheckpoint(cwd, "future")).toBeUndefined();
	});

	it("deletes a checkpoint idempotently", () => {
		const cwd = makeCwd();
		saveCheckpoint(cwd, fullCheckpoint());
		deleteCheckpoint(cwd, "s1");
		expect(loadCheckpoint(cwd, "s1")).toBeUndefined();
		expect(() => deleteCheckpoint(cwd, "s1")).not.toThrow();
	});
});

describe("formatCheckpoint", () => {
	it("renders each populated section", () => {
		const text = formatCheckpoint(fullCheckpoint());
		expect(text).toContain("Goal: port the memory extension");
		expect(text).toContain("Done:");
		expect(text).toContain("In progress:");
		expect(text).toContain("Next:");
		expect(text).toContain("drop the Rust backend");
		expect(text).toContain("Constraints:");
	});

	it("omits recovered issues from the open-issues section", () => {
		const checkpoint = checkpointFromDraft("s1", {
			goal: "g",
			issues: [
				{ message: "fixed already", recovered: true },
				{ message: "still open", recovered: false },
			],
		});
		const text = formatCheckpoint(checkpoint);
		expect(text).toContain("still open");
		expect(text).not.toContain("fixed already");
	});

	it("renders an empty checkpoint without throwing", () => {
		expect(() => formatCheckpoint(checkpointFromDraft("s1", {}))).not.toThrow();
	});
});

describe("compactCheckpoint", () => {
	it("is empty for undefined", () => {
		expect(compactCheckpoint(undefined)).toBe("");
	});

	it("names the goal, current work, next step and blockers", () => {
		const checkpoint = checkpointFromDraft("s1", {
			...FULL_DRAFT,
			issues: [{ message: "socket refused", recovered: false }],
		});
		const text = compactCheckpoint(checkpoint);
		expect(text).toContain("Goal: port the memory extension");
		expect(text).toContain("Current: wiring session-state");
		expect(text).toContain("Next: port the tools extension");
		expect(text).toContain("Blockers: socket refused");
	});

	it("is byte-stable across calls", () => {
		const checkpoint = fullCheckpoint();
		expect(compactCheckpoint(checkpoint)).toBe(compactCheckpoint(checkpoint));
	});

	it("stays short relative to the full rendering", () => {
		const checkpoint = fullCheckpoint();
		expect(compactCheckpoint(checkpoint).length).toBeLessThan(formatCheckpoint(checkpoint).length);
	});
});
