import { describe, expect, it } from "vitest";
import { nextStreamingTextOffset } from "./smooth-stream";

describe("nextStreamingTextOffset", () => {
	it("reveals small backlogs gently", () => {
		expect(nextStreamingTextOffset(0, "small reply", 32)).toBe(3);
	});

	it("accelerates as the undisplayed backlog grows", () => {
		const medium = nextStreamingTextOffset(0, "x".repeat(100), 32);
		const large = nextStreamingTextOffset(0, "x".repeat(600), 32);
		const huge = nextStreamingTextOffset(0, "x".repeat(10_000), 32);
		expect(medium).toBeGreaterThan(3);
		expect(large).toBeGreaterThan(medium);
		expect(huge).toBe(800);
	});

	it("finishes without advancing past the target", () => {
		expect(nextStreamingTextOffset(9, "0123456789", 32)).toBe(10);
		expect(nextStreamingTextOffset(10, "0123456789", 32)).toBe(10);
	});

	it("does not split surrogate pairs", () => {
		const target = `12😀rest`;
		expect(nextStreamingTextOffset(0, target, 32)).toBe(4);
		expect(target.slice(0, nextStreamingTextOffset(0, target, 32))).toBe("12😀");
	});
});
