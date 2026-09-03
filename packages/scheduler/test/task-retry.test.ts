import { describe, expect, it } from "vitest";
import { computeBackoffMs, normalizeRetryPolicy, shouldRetryRun } from "../src/task-retry.ts";
import type { TaskDefinition } from "../src/types.ts";

function task(retry: TaskDefinition["retry"]): TaskDefinition {
	return {
		id: "t1",
		title: "t",
		prompt: "p",
		schedule: { kind: "once", runAt: "2026-01-01T00:00:00.000Z" },
		status: "active",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		retry,
	};
}

describe("task-retry", () => {
	it("normalizes zero maxAttempts to undefined", () => {
		expect(normalizeRetryPolicy({ maxAttempts: 0 })).toBeUndefined();
	});

	it("computes exponential backoff with cap", () => {
		const policy = normalizeRetryPolicy({
			maxAttempts: 5,
			backoffMs: 1000,
			backoffMultiplier: 2,
			maxBackoffMs: 3000,
		});
		expect(policy).toBeDefined();
		if (!policy) return;
		expect(computeBackoffMs(policy, 1)).toBe(1000);
		expect(computeBackoffMs(policy, 2)).toBe(2000);
		expect(computeBackoffMs(policy, 3)).toBe(3000);
		expect(computeBackoffMs(policy, 4)).toBe(3000);
	});

	it("retries failed attempts within maxAttempts", () => {
		const definition = task({ maxAttempts: 2, retryOn: ["failed"] });
		expect(shouldRetryRun(definition, { status: "failed", attempt: 1 }, "failed")).toBe(true);
		expect(shouldRetryRun(definition, { status: "failed", attempt: 2 }, "failed")).toBe(true);
		expect(shouldRetryRun(definition, { status: "failed", attempt: 3 }, "failed")).toBe(false);
	});

	it("only retries interrupted when configured", () => {
		const failedOnly = task({ maxAttempts: 1, retryOn: ["failed"] });
		const both = task({ maxAttempts: 1, retryOn: ["failed", "interrupted"] });
		expect(shouldRetryRun(failedOnly, { status: "interrupted", attempt: 1 }, "interrupted")).toBe(false);
		expect(shouldRetryRun(both, { status: "interrupted", attempt: 1 }, "interrupted")).toBe(true);
	});
});
