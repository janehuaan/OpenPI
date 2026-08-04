import type { Provider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelsJsonProvider } from "../src/core/model-config.ts";
import { withModelsJsonEndpoint } from "../src/core/models-json-catalog.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

function makeProvider(): Provider {
	return {
		id: "acme",
		name: "Acme",
		api: "openai-responses",
		getModels: () => [],
		getAuth: async () => undefined,
		checkAuth: async () => undefined,
	} as unknown as Provider;
}

function makeConfig(overrides: Partial<ModelsJsonProvider> = {}): ModelsJsonProvider {
	return {
		name: "Acme",
		baseUrl: "https://api.acme.test/v1",
		apiKey: "sk-test",
		api: "openai-responses",
		...overrides,
	} as ModelsJsonProvider;
}

function makeRefreshContext() {
	return {
		allowNetwork: true,
		signal: undefined,
		store: {
			read: async () => undefined,
			write: async () => {},
		},
	} as never;
}

describe("withModelsJsonEndpoint", () => {
	it("discovers models from GET {baseUrl}/models and maps them", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					object: "list",
					data: [
						{ id: "acme-chat", object: "model", owned_by: "acme" },
						{ id: "acme-pro", object: "model", owned_by: "acme" },
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const provider = withModelsJsonEndpoint(makeProvider(), makeConfig());
		await provider.refreshModels?.(makeRefreshContext());

		expect(globalThis.fetch).toHaveBeenCalledWith(
			"https://api.acme.test/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({ authorization: "Bearer sk-test" }),
			}),
		);
		const models = provider.getModels();
		expect(models.map((model) => model.id).sort()).toEqual(["acme-chat", "acme-pro"]);
		expect(models[0]).toMatchObject({
			provider: "acme",
			baseUrl: "https://api.acme.test/v1",
			api: "openai-responses",
			contextWindow: 128_000,
		});
	});

	it("keeps the baseline list when the endpoint is unavailable", async () => {
		globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
		const provider = withModelsJsonEndpoint(makeProvider(), makeConfig());
		await provider.refreshModels?.(makeRefreshContext());
		expect(provider.getModels()).toEqual([]);
	});

	it("does not hit the network without an api key", async () => {
		globalThis.fetch = vi.fn() as unknown as typeof fetch;
		const provider = withModelsJsonEndpoint(makeProvider(), makeConfig({ apiKey: undefined }));
		await provider.refreshModels?.(makeRefreshContext());
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(provider.getModels()).toEqual([]);
	});

	it("respects the network gate", async () => {
		globalThis.fetch = vi.fn() as unknown as typeof fetch;
		const provider = withModelsJsonEndpoint(makeProvider(), makeConfig());
		await provider.refreshModels?.({
			allowNetwork: false,
			store: { read: async () => undefined, write: async () => {} },
		} as never);
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it("inherits context window, cost and reasoning from the built-in catalog when ids match", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					object: "list",
					data: [{ id: "glm-5.2", object: "model" }],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const provider = withModelsJsonEndpoint(makeProvider(), makeConfig());
		await provider.refreshModels?.(makeRefreshContext());

		const model = provider.getModels()[0];
		expect(model.id).toBe("glm-5.2");
		expect(model.contextWindow).toBeGreaterThan(128_000);
		expect(model.reasoning).toBe(true);
		expect(model.cost?.input ?? 0).toBeGreaterThan(0);
		expect(model.maxTokens).toBeGreaterThan(32_768);
	});

	it("normalizes accounts/org model ids before matching the built-in catalog", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					object: "list",
					data: [{ id: "accounts/fireworks/models/deepseek-v4-flash", object: "model" }],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const provider = withModelsJsonEndpoint(makeProvider(), makeConfig());
		await provider.refreshModels?.(makeRefreshContext());

		const model = provider.getModels()[0];
		expect(model.contextWindow).toBeGreaterThan(128_000);
	});

	it("uses a context_window hint from the /models response when the id is unknown", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					object: "list",
					data: [{ id: "acme-mega", object: "model", context_window: 1_000_000 }],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const provider = withModelsJsonEndpoint(makeProvider(), makeConfig());
		await provider.refreshModels?.(makeRefreshContext());

		expect(provider.getModels()[0].contextWindow).toBe(1_000_000);
	});

	it("falls back to defaults for unknown ids without hints", async () => {
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify({ object: "list", data: [{ id: "acme-mystery", object: "model" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;

		const provider = withModelsJsonEndpoint(makeProvider(), makeConfig());
		await provider.refreshModels?.(makeRefreshContext());

		expect(provider.getModels()[0]).toMatchObject({
			contextWindow: 128_000,
			maxTokens: 32_768,
			reasoning: false,
		});
	});

	it("refreshes a stale store whose models all carry discovery defaults", async () => {
		const staleStore = {
			read: async () => ({
				checkedAt: Date.now(),
				models: [
					{
						provider: "acme",
						id: "glm-5.2",
						contextWindow: 128_000,
						maxTokens: 32_768,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					},
				],
			}),
			write: async () => {},
		};
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify({ object: "list", data: [{ id: "glm-5.2", object: "model" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		}) as unknown as typeof fetch;

		const provider = withModelsJsonEndpoint(makeProvider(), makeConfig());
		await provider.refreshModels?.({
			allowNetwork: true,
			signal: undefined,
			store: staleStore,
		} as never);

		expect(globalThis.fetch).toHaveBeenCalled();
		const model = provider.getModels()[0];
		expect(model.contextWindow).toBeGreaterThan(128_000);
	});

	it("keeps a fresh store without re-fetching", async () => {
		const freshStore = {
			read: async () => ({
				checkedAt: Date.now(),
				models: [
					{
						provider: "acme",
						id: "acme-x",
						contextWindow: 64_000,
						maxTokens: 16_384,
						cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
					},
				],
			}),
			write: async () => {},
		};
		globalThis.fetch = vi.fn() as unknown as typeof fetch;

		const provider = withModelsJsonEndpoint(makeProvider(), makeConfig());
		await provider.refreshModels?.({
			allowNetwork: true,
			signal: undefined,
			store: freshStore,
		} as never);

		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(provider.getModels()[0].id).toBe("acme-x");
	});
});
