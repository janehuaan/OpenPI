import { describe, expect, it } from "vitest";
import { scaleByContextWindow } from "../src/scale.ts";

describe("scaleByContextWindow", () => {
	it("is identity at the reference window (128k)", () => {
		expect(scaleByContextWindow(128_000, 2400)).toBe(2400);
	});

	it("scales down linearly for smaller windows", () => {
		expect(scaleByContextWindow(64_000, 2400)).toBe(1200);
		expect(scaleByContextWindow(32_000, 2400)).toBe(600);
	});

	it("returns base for undefined or non-positive windows", () => {
		expect(scaleByContextWindow(undefined, 2400)).toBe(2400);
		expect(scaleByContextWindow(0, 2400)).toBe(2400);
		expect(scaleByContextWindow(-100, 2400)).toBe(2400);
	});

	it("clamps to min", () => {
		expect(scaleByContextWindow(8000, 2400, { min: 600 })).toBe(600);
	});

	it("never scales up (max = base)", () => {
		expect(scaleByContextWindow(1_000_000, 2400, { max: 2400 })).toBe(2400);
	});
});
