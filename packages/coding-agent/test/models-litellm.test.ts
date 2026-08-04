import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ensureLiteLlmLoaded,
	lookupLiteLlmMeta,
	resetLiteLlmForTest,
	setLiteLlmCachePath,
} from "../src/core/models-litellm.ts";

const originalFetch = globalThis.fetch;
const tmpDirs: string[] = [];
let cacheFile = "";

function sampleLiteLlmData() {
	// Mirrors the real file shape (costs are per token).
	return {
		"azure_ai/gpt-5.4-mini": {
			id: "gpt-5.4-mini",
			litellm_provider: "azure_ai",
			max_input_tokens: 400000,
			max_output_tokens: 128000,
			input_cost_per_token: 0.00000025,
			output_cost_per_token: 0.000001,
			cache_read_input_token_cost: 0.000000025,
			cache_creation_input_token_cost: 0,
		},
		"openai/gpt-5.4": {
			model_name: "gpt-5.4",
			litellm_provider: "openai",
			max_input_tokens: 400000,
			max_tokens: 128000,
			input_cost_per_token: 0.000002,
			output_cost_per_token: 0.00001,
		},
		"unknown/broken": {
			litellm_provider: "broken",
		},
	};
}

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "litellm-test-"));
	tmpDirs.push(dir);
	cacheFile = join(dir, "litellm-cache.json");
	setLiteLlmCachePath(cacheFile);
	resetLiteLlmForTest();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs.length = 0;
});

describe("litellm lookup", () => {
	it("fetches, indexes and caches the dataset with cost conversion", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify(sampleLiteLlmData()), { status: 200 });
		}) as unknown as typeof fetch;

		expect(await ensureLiteLlmLoaded()).toBe(true);

		const mini = lookupLiteLlmMeta("gpt-5.4-mini");
		expect(mini?.context).toBe(400_000);
		expect(mini?.output).toBe(128_000);
		// per-token → per-1M-token
		expect(mini?.costInput).toBeCloseTo(0.25, 6);
		expect(mini?.costOutput).toBeCloseTo(1, 6);
		expect(mini?.costCacheRead).toBeCloseTo(0.025, 6);

		const gpt54 = lookupLiteLlmMeta("gpt-5.4");
		expect(gpt54?.context).toBe(400_000);
		expect(gpt54?.output).toBe(128_000);
	});

	it("strips the provider/ prefix when matching bare ids", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify(sampleLiteLlmData()), { status: 200 });
		}) as unknown as typeof fetch;

		await ensureLiteLlmLoaded();
		expect(lookupLiteLlmMeta("gpt-5.4-mini")?.output).toBe(128_000);
	});

	it("serves from the file cache without re-fetching within the TTL", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify(sampleLiteLlmData()), { status: 200 });
		}) as unknown as typeof fetch;
		expect(await ensureLiteLlmLoaded()).toBe(true);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);

		resetLiteLlmForTest();
		expect(await ensureLiteLlmLoaded()).toBe(true);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(lookupLiteLlmMeta("gpt-5.4")?.context).toBe(400_000);
	});

	it("returns false and leaves lookups empty on network failure", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;

		expect(await ensureLiteLlmLoaded()).toBe(false);
		expect(lookupLiteLlmMeta("gpt-5.4")).toBeUndefined();
	});

	it("ignores entries without usable fields", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify(sampleLiteLlmData()), { status: 200 });
		}) as unknown as typeof fetch;

		await ensureLiteLlmLoaded();
		// "unknown/broken" has no id/model_name and no fields → not indexed.
		expect(lookupLiteLlmMeta("broken")).toBeUndefined();
	});
});
