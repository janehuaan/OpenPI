/**
 * Web Search Extension
 *
 * Provides a `web_search` tool for keyword search on the public internet.
 *
 * Provider priority:
 * 1. Tavily  — TAVILY_API_KEY / OPENPI_TAVILY_API_KEY
 * 2. Brave   — BRAVE_API_KEY / OPENPI_BRAVE_API_KEY
 * 3. DuckDuckGo HTML (no key)
 *
 * Keys may also live in ~/.pi/agent/secrets.env (KEY=value lines).
 * Pair with web_fetch to open result URLs for full page text.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const WebSearchParams = Type.Object({
	query: Type.String({ description: "Search query keywords" }),
	max_results: Type.Optional(
		Type.Number({ description: "Maximum results to return (default: 8, max: 15)", minimum: 1, maximum: 15 }),
	),
	region: Type.Optional(
		Type.String({
			description: "Optional region hint for DuckDuckGo (e.g. wt-wt, us-en, cn-zh). Default: wt-wt",
		}),
	),
});

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface WebSearchDetails {
	provider: "tavily" | "brave" | "duckduckgo";
	query: string;
	count: number;
}

let secretsCache: Record<string, string> | undefined;

function loadAgentSecrets(): Record<string, string> {
	if (secretsCache) return secretsCache;
	const out: Record<string, string> = {};
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	const file = join(agentDir, "secrets.env");
	if (!existsSync(file)) {
		secretsCache = out;
		return out;
	}
	try {
		for (const raw of readFileSync(file, "utf8").split("\n")) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq <= 0) continue;
			const key = line.slice(0, eq).trim();
			let value = line.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			if (key) out[key] = value;
		}
	} catch {
		// ignore unreadable secrets file
	}
	secretsCache = out;
	return out;
}

function envOrSecret(...names: string[]): string | undefined {
	const secrets = loadAgentSecrets();
	for (const name of names) {
		const fromEnv = process.env[name]?.trim();
		if (fromEnv) return fromEnv;
		const fromFile = secrets[name]?.trim();
		if (fromFile) return fromFile;
	}
	return undefined;
}

function tavilyApiKey(): string | undefined {
	return envOrSecret("OPENPI_TAVILY_API_KEY", "TAVILY_API_KEY");
}

function braveApiKey(): string | undefined {
	return envOrSecret("OPENPI_BRAVE_API_KEY", "BRAVE_API_KEY");
}

function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
		.replace(/\s+/g, " ")
		.trim();
}

function stripTags(html: string): string {
	return decodeEntities(html.replace(/<[^>]+>/g, " "));
}

async function searchTavily(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
	const key = tavilyApiKey();
	if (!key) throw new Error("Tavily API key not configured");
	const response = await fetch("https://api.tavily.com/search", {
		method: "POST",
		signal,
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json",
			"User-Agent": "openpi-agent/1.0",
		},
		body: JSON.stringify({
			api_key: key,
			query,
			max_results: Math.min(maxResults, 20),
			include_answer: false,
			include_images: false,
			include_raw_content: false,
			search_depth: "basic",
		}),
	});
	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(
			`Tavily search HTTP ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`,
		);
	}
	const data = (await response.json()) as {
		results?: Array<{ title?: string; url?: string; content?: string }>;
	};
	return (data.results ?? [])
		.filter((row) => row.url && row.title)
		.slice(0, maxResults)
		.map((row) => ({
			title: row.title ?? "",
			url: row.url ?? "",
			snippet: row.content ?? "",
		}));
}

async function searchBrave(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
	const key = braveApiKey();
	if (!key) throw new Error("Brave API key not configured");
	const url = new URL("https://api.search.brave.com/res/v1/web/search");
	url.searchParams.set("q", query);
	url.searchParams.set("count", String(Math.min(maxResults, 20)));
	const response = await fetch(url, {
		signal,
		headers: {
			Accept: "application/json",
			"X-Subscription-Token": key,
			"User-Agent": "openpi-agent/1.0",
		},
	});
	if (!response.ok) {
		throw new Error(`Brave search HTTP ${response.status} ${response.statusText}`);
	}
	const data = (await response.json()) as {
		web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
	};
	const rows = data.web?.results ?? [];
	return rows
		.filter((row) => row.url && row.title)
		.slice(0, maxResults)
		.map((row) => ({
			title: row.title ?? "",
			url: row.url ?? "",
			snippet: row.description ?? "",
		}));
}

/** Resolve DuckDuckGo redirect wrappers to the real target URL. */
function unwrapDdgUrl(href: string): string {
	try {
		const u = new URL(href, "https://duckduckgo.com");
		if (u.hostname.includes("duckduckgo.com") && u.pathname === "/l/") {
			const uddg = u.searchParams.get("uddg");
			if (uddg) return decodeURIComponent(uddg);
		}
		return u.href;
	} catch {
		return href;
	}
}

async function searchDuckDuckGo(
	query: string,
	maxResults: number,
	region: string,
	signal?: AbortSignal,
): Promise<SearchResult[]> {
	const endpoints = [
		`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${encodeURIComponent(region || "wt-wt")}`,
		`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
	];
	const headers = {
		"User-Agent":
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
		Accept: "text/html,application/xhtml+xml",
		"Accept-Language": "en-US,en;q=0.9",
	};

	let lastError: Error | undefined;
	for (const endpoint of endpoints) {
		try {
			const response = await fetch(endpoint, { method: "GET", signal, headers, redirect: "follow" });
			if (!response.ok) {
				lastError = new Error(`DuckDuckGo search HTTP ${response.status} ${response.statusText}`);
				continue;
			}
			const html = await response.text();
			const results = parseDdgHtml(html, maxResults);
			if (results.length > 0) return results;
			lastError = new Error("DuckDuckGo returned no parseable results");
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
		}
	}
	throw lastError ?? new Error("DuckDuckGo search failed");
}

function parseDdgHtml(html: string, maxResults: number): SearchResult[] {
	const results: SearchResult[] = [];
	const seen = new Set<string>();

	const classicRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
	for (let match = classicRe.exec(html); match !== null && results.length < maxResults; match = classicRe.exec(html)) {
		const url = unwrapDdgUrl(match[1] ?? "");
		const title = stripTags(match[2] ?? "");
		if (!url.startsWith("http") || !title || seen.has(url)) continue;
		const after = html.slice(match.index, match.index + 1500);
		const snipMatch = after.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)/i);
		const snippet = snipMatch ? stripTags(snipMatch[1] ?? "") : "";
		seen.add(url);
		results.push({ title, url, snippet });
	}

	if (results.length === 0) {
		const liteRe = /<a[^>]*class="[^"]*result-link[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
		for (let match = liteRe.exec(html); match !== null && results.length < maxResults; match = liteRe.exec(html)) {
			const url = unwrapDdgUrl(match[1] ?? "");
			const title = stripTags(match[2] ?? "");
			if (!url.startsWith("http") || !title || seen.has(url) || url.includes("duckduckgo.com")) continue;
			const after = html.slice(match.index, match.index + 1500);
			const snipMatch = after.match(/class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\//i);
			const snippet = snipMatch ? stripTags(snipMatch[1] ?? "") : "";
			seen.add(url);
			results.push({ title, url, snippet });
		}
	}

	return results;
}

function formatResults(query: string, provider: string, results: SearchResult[]): string {
	if (results.length === 0) {
		return `No web results for: ${query}\n(provider: ${provider})`;
	}
	const lines = [
		`Web search: ${query}`,
		`Provider: ${provider} · ${results.length} result(s)`,
		`Tip: use web_fetch on a result URL to read the full page.`,
		"",
	];
	for (const [index, row] of results.entries()) {
		lines.push(`${index + 1}. ${row.title}`);
		lines.push(`   ${row.url}`);
		if (row.snippet) lines.push(`   ${row.snippet}`);
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the public web by keyword. Returns titles, URLs, and short snippets. Prefer this for current events/docs discovery, then web_fetch useful URLs. Providers: Tavily (TAVILY_API_KEY / OPENPI_TAVILY_API_KEY), Brave (BRAVE_API_KEY), else DuckDuckGo (no key). Keys may also be in ~/.pi/agent/secrets.env.",
		promptSnippet: "Use web_search for internet keyword search; follow up with web_fetch on useful URLs",
		parameters: WebSearchParams,

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const query = params.query.trim();
			const maxResults = Math.min(15, Math.max(1, params.max_results ?? 8));
			const region = params.region?.trim() || "wt-wt";

			if (!query) {
				return {
					content: [{ type: "text", text: "Error: query is required" }],
					details: { provider: "duckduckgo", query, count: 0 } satisfies WebSearchDetails,
				};
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 25_000);
			if (signal) {
				signal.addEventListener("abort", () => controller.abort(), { once: true });
			}

			try {
				let results: SearchResult[] | undefined;
				let provider: WebSearchDetails["provider"] = "duckduckgo";
				const errors: string[] = [];

				if (tavilyApiKey()) {
					try {
						results = await searchTavily(query, maxResults, controller.signal);
						provider = "tavily";
					} catch (error) {
						errors.push(`tavily: ${error instanceof Error ? error.message : String(error)}`);
					}
				}

				if (!results && braveApiKey()) {
					try {
						results = await searchBrave(query, maxResults, controller.signal);
						provider = "brave";
					} catch (error) {
						errors.push(`brave: ${error instanceof Error ? error.message : String(error)}`);
					}
				}

				if (!results) {
					try {
						results = await searchDuckDuckGo(query, maxResults, region, controller.signal);
						provider = "duckduckgo";
					} catch (error) {
						errors.push(`duckduckgo: ${error instanceof Error ? error.message : String(error)}`);
						throw new Error(errors.join(" | ") || "All search providers failed");
					}
				}

				return {
					content: [{ type: "text", text: formatResults(query, provider, results) }],
					details: { provider, query, count: results.length } satisfies WebSearchDetails,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `Error searching the web for "${query}": ${message}`,
						},
					],
					details: { provider: "duckduckgo", query, count: 0 } satisfies WebSearchDetails,
				};
			} finally {
				clearTimeout(timeoutId);
			}
		},
	});
}
