import { describe, expect, it } from "vitest";
import { selectSnapshotEntries } from "../src/snapshot.ts";
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig, type MemoryIndexEntry } from "../src/types.ts";

const config: MemoryConfig = {
	...DEFAULT_MEMORY_CONFIG,
	proactiveInject: true,
	maxSnapshotEntries: 5,
	pinTypes: ["user", "feedback"],
};

function entry(type: string, key: string, value: string): MemoryIndexEntry {
	return { type: type as MemoryIndexEntry["type"], key, value };
}

describe("selectSnapshotEntries with rankedRest", () => {
	it("pins user/feedback first and fills the rest from ranked candidates", () => {
		const entries = [
			entry("user", "language", "prefers zh"),
			entry("project", "a", "alpha project note"),
			entry("project", "b", "beta project note"),
			entry("project", "c", "gamma project note"),
			entry("project", "d", "delta project note"),
			entry("feedback", "style", "be concise"),
		];

		// rankedRest: most relevant first (b, c, d, a).
		const rankedRest = [entries[2], entries[3], entries[4], entries[1]];
		const selected = selectSnapshotEntries(entries, "prompt", config, undefined, undefined, rankedRest);

		expect(selected[0]).toBe(entries[0]); // user pinned
		expect(selected[1]).toBe(entries[5]); // feedback pinned
		expect(selected.slice(2)).toEqual([entries[2], entries[3], entries[4]]); // ranked fill, capped at 5
	});

	it("falls back to stable order when rankedRest is empty or absent", () => {
		const entries = [entry("project", "z", "last"), entry("project", "a", "first"), entry("user", "u", "pinned")];
		const selected = selectSnapshotEntries(entries, "prompt", config, undefined, undefined, []);
		expect(selected[0]).toBe(entries[2]);
		expect(selected[1].key).toBe("a"); // stable type+key order
		expect(selected[2].key).toBe("z");
	});

	it("never exceeds maxSnapshotEntries even with many ranked candidates", () => {
		const entries = [
			entry("user", "u", "pinned"),
			...Array.from({ length: 20 }, (_, i) => entry("project", `k${i}`, `value ${i}`)),
		];
		const selected = selectSnapshotEntries(entries, "p", config, undefined, undefined, entries.slice(1));
		expect(selected.length).toBeLessThanOrEqual(5);
		expect(selected[0]).toBe(entries[0]);
	});
});
