import { describe, it, expect } from "vitest";
import { isModelOutageOrRateLimitError, pickCascadeFallbackModel } from "../electron/model-cascade";

describe("Model Cascade Fallback Engine", () => {
	it("accurately detects rate limit and outage errors", () => {
		expect(isModelOutageOrRateLimitError(new Error("429 Too Many Requests: Rate limit reached"))).toBe(true);
		expect(isModelOutageOrRateLimitError("Error: quota_exceeded for current billing period")).toBe(true);
		expect(isModelOutageOrRateLimitError("503 Service Unavailable: model overloaded")).toBe(true);
		expect(isModelOutageOrRateLimitError("504 Gateway Timeout")).toBe(true);
		expect(isModelOutageOrRateLimitError("insufficient_quota")).toBe(true);
		expect(isModelOutageOrRateLimitError("server is busy, please try again later")).toBe(true);

		// Regular errors should NOT trigger fallback
		expect(isModelOutageOrRateLimitError(new Error("File not found: /tmp/test.txt"))).toBe(false);
		expect(isModelOutageOrRateLimitError("SyntaxError: Unexpected token")).toBe(false);
		expect(isModelOutageOrRateLimitError("Invalid argument: prompt is required")).toBe(false);
	});

	it("prefers user configured fallback model when specified", () => {
		const models = [
			{ provider: "openai", id: "gpt-4o" },
			{ provider: "anthropic", id: "claude-3-7-sonnet" },
			{ provider: "ollama", id: "minicpm-2b" },
		];

		const fallback = pickCascadeFallbackModel(
			{ provider: "openai", id: "gpt-4o" },
			models,
			{ provider: "ollama", id: "minicpm-2b" },
		);

		expect(fallback).toEqual({ provider: "ollama", id: "minicpm-2b" });
	});

	it("automatically selects alternate provider when primary provider fails", () => {
		const models = [
			{ provider: "openai", id: "gpt-4o" },
			{ provider: "openai", id: "gpt-4o-mini" },
			{ provider: "anthropic", id: "claude-3-7-sonnet" },
		];

		const fallback = pickCascadeFallbackModel(
			{ provider: "openai", id: "gpt-4o" },
			models,
		);

		expect(fallback?.provider).toBe("anthropic");
		expect(fallback?.id).toBe("claude-3-7-sonnet");
	});

	it("falls back to alternate tier within same provider if single provider configured", () => {
		const models = [
			{ provider: "openai", id: "gpt-4o" },
			{ provider: "openai", id: "gpt-4o-mini" },
		];

		const fallback = pickCascadeFallbackModel(
			{ provider: "openai", id: "gpt-4o" },
			models,
		);

		expect(fallback?.id).toBe("gpt-4o-mini");
	});

	it("returns null when no candidates available", () => {
		expect(pickCascadeFallbackModel({ provider: "openai", id: "gpt-4o" }, [])).toBeNull();
		expect(
			pickCascadeFallbackModel(
				{ provider: "openai", id: "gpt-4o" },
				[{ provider: "openai", id: "gpt-4o" }],
			),
		).toBeNull();
	});
});
