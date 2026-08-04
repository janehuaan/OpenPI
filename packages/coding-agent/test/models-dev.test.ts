import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ensureModelsDevLoaded,
	lookupModelsDevMeta,
	resetModelsDevForTest,
	setModelsDevCachePath,
} from "../src/core/models-dev.ts";

const originalFetch = globalThis.fetch;
const tmpDirs: string[] = [];
let cacheFile = "";

function sampleModelsDevData() {
	return {
		zhipuai: {
			models: {
				"glm-5.2": {
					id: "glm-5.2",
					limit: { context: 1_000_000, output: 131_072 },
					cost: { input: 1.4, output: 4.4, cache_read: 0.26, cache_write: 0 },
					reasoning: true,
				},
			},
		},
		"opencode-go": {
			models: {
				hy3: {
					id: "hy3",
					limit: { context: 256_000, output: 64_000 },
					cost: { input: 0.14, output: 0.58, cache_read: 0.035, cache_write: 0 },
					reasoning: true,
				},
			},
		},
	};
}

beforeEach(() => {
	const dir = mkdtempSync(join(tmpdir(), "models-dev-test-"));
	tmpDirs.push(dir);
	cacheFile = join(dir, "models-dev-cache.json");
	setModelsDevCachePath(cacheFile);
	resetModelsDevForTest();
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs.length = 0;
});

describe("models-dev lookup", () => {
	it("fetches, indexes and caches the dataset", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify(sampleModelsDevData()), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;

		expect(await ensureModelsDevLoaded()).toBe(true);

		const meta = lookupModelsDevMeta("glm-5.2");
		expect(meta?.context).toBe(1_000_000);
		expect(meta?.output).toBe(131_072);
		expect(meta?.costInput).toBe(1.4);
		expect(meta?.costOutput).toBe(4.4);
		expect(meta?.reasoning).toBe(true);

		const hy3 = lookupModelsDevMeta("hy3");
		expect(hy3?.context).toBe(256_000);
	});

	it("serves from the file cache without re-fetching within the TTL", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify(sampleModelsDevData()), { status: 200 });
		}) as unknown as typeof fetch;
		expect(await ensureModelsDevLoaded()).toBe(true);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);

		resetModelsDevForTest();
		expect(await ensureModelsDevLoaded()).toBe(true);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(lookupModelsDevMeta("glm-5.2")?.context).toBe(1_000_000);
	});

	it("returns false and leaves lookups empty on network failure", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;

		expect(await ensureModelsDevLoaded()).toBe(false);
		expect(lookupModelsDevMeta("glm-5.2")).toBeUndefined();
	});

	it("returns false on a non-200 response", async () => {
		globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;

		expect(await ensureModelsDevLoaded()).toBe(false);
	});

	it("re-fetches when the cache is expired", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify(sampleModelsDevData()), { status: 200 });
		}) as unknown as typeof fetch;
		expect(await ensureModelsDevLoaded()).toBe(true);

		// Age the cache file beyond the TTL (24h).
		const { writeFileSync } = await import("fs");
		const cached = JSON.parse(await (await import("fs/promises")).readFile(cacheFile, "utf8"));
		cached.fetchedAt = Date.now() - 25 * 60 * 60 * 1000;
		writeFileSync(cacheFile, JSON.stringify(cached), "utf8");

		resetModelsDevForTest();
		expect(await ensureModelsDevLoaded()).toBe(true);
		expect(globalThis.fetch).toHaveBeenCalledTimes(2);
	});

	it("ignores malformed entries gracefully", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					"provider-a": {
						models: {
							broken: { id: "broken" },
							good: { id: "good", limit: { context: 42 }, cost: { input: 0.5 } },
						},
					},
					"not-a-provider": "garbage",
				}),
				{ status: 200 },
			);
		}) as unknown as typeof fetch;

		expect(await ensureModelsDevLoaded()).toBe(true);
		expect(lookupModelsDevMeta("good")?.context).toBe(42);
		expect(lookupModelsDevMeta("broken")).toBeUndefined();
	});
});
