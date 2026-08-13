import { describe, expect, it } from "vitest";
import { createHarness } from "../harness.ts";

describe("short-context request preflight", () => {
	it("rejects an oversized request before calling the provider", async () => {
		const harness = await createHarness({
			models: [{ id: "short-context", contextWindow: 64, maxTokens: 32 }],
			systemPrompt: "x".repeat(400),
			settings: { compaction: { enabled: false } },
		});

		try {
			await expect(harness.session.prompt("hello")).rejects.toThrow(
				/context is too large for faux\/short-context: estimated .* model limit 64/i,
			);
			expect(harness.faux.state.callCount).toBe(0);
		} finally {
			harness.cleanup();
		}
	});

	it("counts context injected by extensions without running the extension twice", async () => {
		let contextCalls = 0;
		const harness = await createHarness({
			models: [{ id: "short-context", contextWindow: 64, maxTokens: 32 }],
			settings: { compaction: { enabled: false } },
			extensionFactories: [
				(pi) => {
					pi.on("context", async (event) => {
						contextCalls++;
						return {
							messages: [...event.messages, { role: "user", content: "x".repeat(400), timestamp: Date.now() }],
						};
					});
				},
			],
		});

		try {
			await expect(harness.session.prompt("hello")).rejects.toThrow(/context is too large/i);
			expect(contextCalls).toBe(1);
			expect(harness.faux.state.callCount).toBe(0);
		} finally {
			harness.cleanup();
		}
	});
});
