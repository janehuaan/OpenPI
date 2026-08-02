/**
 * Web Fetch Extension
 *
 * Provides a `web_fetch` tool that the LLM can call to retrieve web page content.
 * Uses Node 18+ native `fetch()` — no external dependencies.
 *
 * Features:
 * - Fetch any HTTP/HTTPS URL and extract text content
 * - Configurable timeout and max response size
 * - Basic HTML-to-text conversion (strips scripts, styles, tags)
 * - URL validation (http/https only)
 *
 * Usage:
 *   pi --extension examples/extensions/web-fetch.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const WebFetchParams = Type.Object({
	url: Type.String({ description: "URL to fetch (http/https only)" }),
	max_bytes: Type.Optional(
		Type.Number({ description: "Maximum response body size in bytes (default: 50000)", minimum: 100 }),
	),
	timeout_seconds: Type.Optional(
		Type.Number({ description: "Request timeout in seconds (default: 15, minimum: 1)", minimum: 1 }),
	),
});

interface WebFetchDetails {
	status: number;
	title?: string;
	content_length: number;
	truncated: boolean;
}

function stripHtml(html: string): string {
	// Remove script and style elements
	let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
	text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
	// Remove HTML tags
	text = text.replace(/<[^>]+>/g, " ");
	// Decode common HTML entities
	text = text.replace(/&nbsp;/g, " ");
	text = text.replace(/&lt;/g, "<");
	text = text.replace(/&gt;/g, ">");
	text = text.replace(/&amp;/g, "&");
	text = text.replace(/&quot;/g, '"');
	text = text.replace(/&#39;/g, "'");
	// Collapse whitespace
	text = text.replace(/\s+/g, " ").trim();
	return text;
}

function extractTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
	return match?.[1]?.trim();
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch the text content of a web page by URL (http/https only). Prefer web_search first when you only have keywords, then web_fetch the best result URLs for full content.",
		promptSnippet: "Use web_fetch to read a page after web_search or when you already have a URL",
		parameters: WebFetchParams,

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const url = params.url;
			const maxBytes = params.max_bytes ?? 50000;
			const timeoutSeconds = params.timeout_seconds ?? 15;

			// Validate URL scheme
			if (!url.startsWith("http://") && !url.startsWith("https://")) {
				return {
					content: [{ type: "text", text: `Error: Only http/https URLs are allowed, got: ${url}` }],
					details: { status: 0, content_length: 0, truncated: false } satisfies WebFetchDetails,
				};
			}

			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

				// Chain with the tool's abort signal so user cancellation works
				if (signal) {
					signal.addEventListener("abort", () => controller.abort(), { once: true });
				}

				const response = await fetch(url, {
					signal: controller.signal,
					headers: {
						"User-Agent": "pi-agent/1.0",
						Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					},
					redirect: "follow",
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					return {
						content: [{ type: "text", text: `Error: HTTP ${response.status} ${response.statusText} for ${url}` }],
						details: { status: response.status, content_length: 0, truncated: false } satisfies WebFetchDetails,
					};
				}

				const buffer = await response.arrayBuffer();
				const rawText = new TextDecoder().decode(buffer);
				const title = extractTitle(rawText);
				const text = stripHtml(rawText);
				const truncated = text.length > maxBytes;
				const content = truncated ? text.slice(0, maxBytes) : text;

				return {
					content: [
						{
							type: "text",
							text: [title ? `# ${title}\n\n` : "", content].join(""),
						},
					],
					details: {
						status: response.status,
						title,
						content_length: text.length,
						truncated,
					} satisfies WebFetchDetails,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Error fetching ${url}: ${message}` }],
					details: { status: 0, content_length: 0, truncated: false } satisfies WebFetchDetails,
				};
			}
		},
	});
}
