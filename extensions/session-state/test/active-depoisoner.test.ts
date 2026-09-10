import { describe, it, expect } from "vitest";
import { depoisonToolOutput, extractErrorSignal } from "../src/active-depoisoner.ts";

describe("Active Stream De-poisoner", () => {
	it("leaves small clean outputs untouched", () => {
		const small = "Hello world\nSuccess!";
		const res = depoisonToolOutput(small, "bash", false);
		expect(res.depoisoned).toBe(false);
		expect(res.text).toBe(small);
	});

	it("folds massive clean logs, preserving head and tail", () => {
		// Generate 150 lines of build noise
		const lines = Array.from({ length: 150 }, (_, i) => `[build step ${i + 1}] compiling asset...`);
		const massive = lines.join("\n");

		const res = depoisonToolOutput(massive, "bash", false, {
			maxCleanLines: 50,
			headLines: 10,
			tailLines: 10,
		});

		expect(res.depoisoned).toBe(true);
		expect(res.reason).toBe("folded_large_output");
		expect(res.savedChars).toBeGreaterThan(1000);
		expect(res.text).toContain("[build step 1]");
		expect(res.text).toContain("[build step 150]");
		expect(res.text).toContain("Folded 130 lines");
	});

	it("distills large noisy error dumps down to the core error signature", () => {
		// 80 lines of noisy progress + 1 critical error + 20 lines of follow-up noise
		const noisy = [
			...Array.from({ length: 40 }, (_, i) => `info: downloaded package chunk ${i}`),
			"npm ERR! code ELIFECYCLE",
			"npm ERR! errno 1",
			"Error: Cannot find module '@openpi/core'",
			"    at Function.Module._resolveFilename (node:internal/modules/cjs/loader:1144:15)",
			...Array.from({ length: 30 }, (_, i) => `warn: deprecated package chunk ${i}`),
		].join("\n");

		const res = depoisonToolOutput(noisy, "bash", true, { maxErrorLines: 15 });

		expect(res.depoisoned).toBe(true);
		expect(res.reason).toBe("extracted_error_signal");
		expect(res.text).toContain("Error: Cannot find module '@openpi/core'");
		expect(res.text).toContain("npm ERR! code ELIFECYCLE");
		expect(res.text).toContain("Verbose error stream distilled to core failure signal");
		expect(res.savedChars).toBeGreaterThan(500);
	});
});
