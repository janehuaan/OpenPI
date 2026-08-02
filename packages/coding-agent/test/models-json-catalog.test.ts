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
});
