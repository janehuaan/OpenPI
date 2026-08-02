/**
 * Web fetch tool (built-in).
 *
 * Fetches an HTTP/HTTPS URL and returns readable text content. SSRF guard:
 * literal private/loopback/link-local hosts are rejected before fetching.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";

const WebFetchParams = Type.Object({
	url: Type.String({ description: "URL to fetch (http/https only)" }),
	max_bytes: Type.Optional(
		Type.Number({ description: "Maximum response body size in bytes (default: 50000)", minimum: 100 }),
	),
	timeout_seconds: Type.Optional(
		Type.Number({ description: "Request timeout in seconds (default: 15, minimum: 1)", minimum: 1 }),
	),
});

export interface WebFetchDetails {
	status: number;
	title?: string;
	content_length: number;
	truncated: boolean;
}

const DEFAULT_MAX_BYTES = 50_000;
const DEFAULT_TIMEOUT_SECONDS = 15;

/** IP blocks that must never be fetched: loopback, private, link-local, unspecified. */
const BLOCKED_IP_PATTERNS = [
	/^0\./, // 0.0.0.0/8
	/^10\./, // 10/8
	/^127\./, // loopback
	/^169\.254\./, // link-local
	/^172\.(1[6-9]|2\d|3[01])\./, // 172.16/12
	/^192\.168\./, // 192.168/16
	/^100\.(6[4-9]|[7-9]\d)\./, // 100.64/10 (CGNAT)
	/^::1$/, // IPv6 loopback
	/^::$/, // IPv6 unspecified
	/^fc[0-9a-f]{2}:/i, // fc00::/7
	/^fd[0-9a-f]{2}:/i, // fd00::/7
	/^fe80:/i, // link-local IPv6
];

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);

export function isBlockedWebHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	if (BLOCKED_HOSTNAMES.has(host)) return true;
	// Strip IPv6 brackets.
	const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	return BLOCKED_IP_PATTERNS.some((pattern) => pattern.test(bare));
}

function stripHtml(html: string): string {
	let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
	text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
	text = text.replace(/<[^>]+>/g, " ");
	text = text.replace(/&nbsp;/g, " ");
	text = text.replace(/&lt;/g, "<");
	text = text.replace(/&gt;/g, ">");
	text = text.replace(/&amp;/g, "&");
	text = text.replace(/&quot;/g, '"');
	text = text.replace(/&#39;/g, "'");
	text = text.replace(/\s+/g, " ").trim();
	return text;
}

function extractTitle(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
	return match?.[1]?.trim();
}

export function createWebFetchToolDefinition(): ToolDefinition<typeof WebFetchParams, WebFetchDetails | undefined> {
	return {
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch an HTTP/HTTPS URL and return its text content. Use for reading web pages, API responses, or documentation. Private and loopback addresses are blocked.",
		promptSnippet: "Fetch web pages and APIs (SSRF-safe)",
		parameters: WebFetchParams,
		execute: async (_toolCallId, params) => {
			const url = new URL(params.url);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				return webFetchError("Only http and https URLs are supported");
			}
			if (isBlockedWebHost(url.hostname)) {
				return webFetchError(
					`Blocked by SSRF guard: ${url.hostname} is a private, loopback, or link-local address`,
				);
			}

			const timeoutSeconds = params.timeout_seconds ?? DEFAULT_TIMEOUT_SECONDS;
			const maxBytes = params.max_bytes ?? DEFAULT_MAX_BYTES;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

			try {
				const response = await fetch(url, {
					signal: controller.signal,
					redirect: "follow",
					headers: { "user-agent": "pi-coding-agent/0.80.8" },
				});
				const contentType = response.headers.get("content-type") ?? "";
				const isText = contentType.includes("text/") || contentType.includes("json") || contentType.includes("xml");
				const buffer = new Uint8Array(await response.arrayBuffer());
				let body: string;
				if (isText || buffer.length === 0) {
					body = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
				} else {
					body = `[binary response: ${buffer.length} bytes, content-type ${contentType || "unknown"}]`;
				}

				const truncated = body.length > maxBytes;
				const sliced = truncated ? body.slice(0, maxBytes) : body;
				const text = stripHtml(sliced);
				const details: WebFetchDetails = {
					status: response.status,
					title: extractTitle(sliced),
					content_length: body.length,
					truncated,
				};
				return {
					content: [
						{
							type: "text",
							text:
								`status: ${response.status}\n` +
								(details.title ? `title: ${details.title}\n` : "") +
								(text.length > 0 ? text : "(no readable text content)"),
						},
					],
					details,
				};
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				if (error instanceof Error && error.name === "AbortError") {
					return webFetchError(`Request timed out after ${timeoutSeconds}s`);
				}
				return webFetchError(`Fetch failed: ${reason}`);
			} finally {
				clearTimeout(timer);
			}
		},
	};
}

function webFetchError(message: string): AgentToolResult<WebFetchDetails | undefined> {
	return {
		content: [{ type: "text", text: `web_fetch error: ${message}` }],
		details: undefined,
	};
}
