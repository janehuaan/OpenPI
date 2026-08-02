import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebFetchToolDefinition, isBlockedWebHost } from "../../src/core/tools/web-fetch.ts";
import { createWebSearchToolDefinition } from "../../src/core/tools/web-search.ts";

const originalFetch = globalThis.fetch;

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
	const block = result.content[0];
	return block && block.type === "text" ? (block.text ?? "") : "";
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("isBlockedWebHost", () => {
	it("blocks loopback and local hosts", () => {
		expect(isBlockedWebHost("127.0.0.1")).toBe(true);
		expect(isBlockedWebHost("127.0.0.2")).toBe(true);
		expect(isBlockedWebHost("localhost")).toBe(true);
		expect(isBlockedWebHost("localhost.localdomain")).toBe(true);
		expect(isBlockedWebHost("::1")).toBe(true);
	});

	it("blocks private and link-local ranges", () => {
		expect(isBlockedWebHost("10.0.0.1")).toBe(true);
		expect(isBlockedWebHost("172.16.0.1")).toBe(true);
		expect(isBlockedWebHost("172.31.255.255")).toBe(true);
		expect(isBlockedWebHost("192.168.1.1")).toBe(true);
		expect(isBlockedWebHost("169.254.169.254")).toBe(true);
		expect(isBlockedWebHost("100.64.0.1")).toBe(true);
		expect(isBlockedWebHost("0.0.0.0")).toBe(true);
		expect(isBlockedWebHost("fe80::1")).toBe(true);
		expect(isBlockedWebHost("fc00::1")).toBe(true);
	});

	it("allows public hosts", () => {
		expect(isBlockedWebHost("example.com")).toBe(false);
		expect(isBlockedWebHost("8.8.8.8")).toBe(false);
		expect(isBlockedWebHost("172.32.0.1")).toBe(false);
		expect(isBlockedWebHost("192.169.0.1")).toBe(false);
	});
});

describe("web_fetch", () => {
	it("blocks private addresses before fetching", async () => {
		const fetchMock = vi.fn();
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		const tool = createWebFetchToolDefinition();

		const result = await tool.execute(
			"call-1",
			{ url: "http://127.0.0.1:8080/admin" },
			undefined,
			undefined,
			undefined as never,
		);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("SSRF guard") });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects non-http(s) protocols", async () => {
		const tool = createWebFetchToolDefinition();
		const result = await tool.execute(
			"call-1",
			{ url: "file:///etc/passwd" },
			undefined,
			undefined,
			undefined as never,
		);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Only http and https") });
	});

	it("fetches public URLs and strips HTML", async () => {
		globalThis.fetch = vi.fn(async () => {
			const body = "<html><head><title>Test Page</title></head><body><p>Hello <b>world</b></p></body></html>";
			return new Response(body, {
				status: 200,
				headers: { "content-type": "text/html" },
			});
		}) as unknown as typeof fetch;

		const tool = createWebFetchToolDefinition();
		const result = await tool.execute(
			"call-1",
			{ url: "https://example.com/page" },
			undefined,
			undefined,
			undefined as never,
		);
		const text = resultText(result);
		expect(text).toContain("status: 200");
		expect(text).toContain("title: Test Page");
		expect(text).toContain("Hello world");
	});

	it("returns an error result when the request fails", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("network down");
		}) as unknown as typeof fetch;

		const tool = createWebFetchToolDefinition();
		const result = await tool.execute(
			"call-1",
			{ url: "https://example.com/fail" },
			undefined,
			undefined,
			undefined as never,
		);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("network down") });
	});
});

describe("web_search", () => {
	it("uses DuckDuckGo when no API keys are configured", async () => {
		delete process.env.TAVILY_API_KEY;
		delete process.env.OPENPI_TAVILY_API_KEY;
		delete process.env.BRAVE_API_KEY;
		delete process.env.OPENPI_BRAVE_API_KEY;

		const ddgHtml = `
			<html><body>
			<a class="result__a" href="https://example.com/1">First Result</a>
			<div class="result__snippet">Snippet one</div>
			<a class="result__a" href="https://example.com/2">Second Result</a>
			<div class="result__snippet">Snippet two</div>
			</body></html>
		`;
		globalThis.fetch = vi.fn(async () => new Response(ddgHtml, { status: 200 })) as unknown as typeof fetch;

		const tool = createWebSearchToolDefinition();
		const result = await tool.execute(
			"call-1",
			{ query: "pi coding agent" },
			undefined,
			undefined,
			undefined as never,
		);
		const text = resultText(result);
		expect(text).toContain("1. First Result");
		expect(text).toContain("https://example.com/1");
		expect(text).toContain("2. Second Result");
		expect(text).toContain("Snippet one");
	});

	it("prefers Tavily when its key is set", async () => {
		process.env.OPENPI_TAVILY_API_KEY = "test-key";
		globalThis.fetch = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					results: [{ title: "T", url: "https://t.example", content: "c" }],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const tool = createWebSearchToolDefinition();
		const result = await tool.execute("call-1", { query: "test" }, undefined, undefined, undefined as never);
		const text = resultText(result);
		expect(text).toContain("Provider: tavily");
		expect(text).toContain("https://t.example");
		delete process.env.OPENPI_TAVILY_API_KEY;
	});

	it("returns an error message when all providers fail", async () => {
		delete process.env.TAVILY_API_KEY;
		delete process.env.OPENPI_TAVILY_API_KEY;
		delete process.env.BRAVE_API_KEY;
		delete process.env.OPENPI_BRAVE_API_KEY;
		globalThis.fetch = vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch;

		const tool = createWebSearchToolDefinition();
		const result = await tool.execute("call-1", { query: "nothing" }, undefined, undefined, undefined as never);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Error searching") });
	});
});
