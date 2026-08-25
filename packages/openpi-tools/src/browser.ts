/**
 * 浏览器自动化 (browser automation) plugin — zero npm dependencies.
 *
 * One `browser` tool with actions:
 *   open      — launch Chrome (headless by default) and navigate to a URL
 *   snapshot  — return current page URL/title + visible text
 *   click     — click an element by CSS selector or visible text
 *   type      — fill an input/textarea by selector or visible text
 *   back      — navigate back one page
 *   close     — shut the browser session down
 *
 * Implementation drives Chrome over the DevTools Protocol (CDP) directly:
 * launch with --remote-debugging-port=0, read DevToolsActivePort, connect a
 * WebSocket (Node >=22 global WebSocket) and send Page/Runtime/Input commands.
 * No Playwright/puppeteer install or browser download is needed.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// CDP client
// ============================================================================

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

interface CdpPage {
	ws: WebSocket;
	nextId: number;
	pending: Map<number, PendingRequest>;
	url: string;
}

function findChromeBinary(): string | undefined {
	const candidates = [
		process.env.OPENPI_CHROME_PATH,
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/usr/bin/chromium-browser",
		"/usr/bin/microsoft-edge",
		"/usr/bin/brave-browser",
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
	].filter((p): p is string => Boolean(p));
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	// PATH lookup for chrome/chromium
	for (const name of ["google-chrome", "chromium", "chromium-browser", "chrome", "msedge"]) {
		const parts = (process.env.PATH ?? "").split(":");
		for (const dir of parts) {
			if (!dir) continue;
			const path = join(dir, name);
			if (existsSync(path)) return path;
		}
	}
	return undefined;
}

function waitFor(fn: () => boolean, timeoutMs: number, intervalMs = 100): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	return new Promise((resolve, reject) => {
		const tick = () => {
			if (fn()) return resolve();
			if (Date.now() > deadline) return reject(new Error("Timed out waiting for browser"));
			setTimeout(tick, intervalMs);
		};
		tick();
	});
}

async function readWsUrl(userDataDir: string): Promise<string> {
	// Chrome writes DevToolsActivePort: line1=port line2=browser ws path
	const portFile = join(userDataDir, "DevToolsActivePort");
	await waitFor(() => existsSync(portFile), 15_000);
	const [port, wsPath] = readFileSync(portFile, "utf8").split("\n");
	if (!port || !wsPath) throw new Error("DevToolsActivePort missing browser ws path");
	return `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
}

function connectCdp(wsUrl: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl);
		ws.addEventListener("open", () => resolve(ws), { once: true });
		ws.addEventListener("error", () => reject(new Error(`CDP connect failed: ${wsUrl}`)), { once: true });
	});
}

async function jsonList(
	wsUrl: string,
): Promise<Array<{ id: string; type: string; url: string; webSocketDebuggerUrl?: string }>> {
	const portMatch = wsUrl.match(/ws:\/\/127\.0\.0\.1:(\d+)/);
	if (!portMatch) throw new Error("Cannot derive debug port from ws url");
	const response = await fetch(`http://127.0.0.1:${portMatch[1]}/json/list`);
	if (!response.ok) throw new Error(`CDP /json/list HTTP ${response.status}`);
	return (await response.json()) as Array<{
		id: string;
		type: string;
		url: string;
		webSocketDebuggerUrl?: string;
	}>;
}

// ============================================================================
// Session
// ============================================================================

interface BrowserSession {
	process: ChildProcess;
	userDataDir: string;
	page: CdpPage;
}

let session: BrowserSession | undefined;

async function launch(wsUrl: string, userDataDir: string, processHandle: ChildProcess): Promise<void> {
	const list = await jsonList(wsUrl);
	let target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
	if (!target) {
		const browserWs = await connectCdp(wsUrl);
		await cdpCall(browserWs, "Target.createTarget", { url: "about:blank" });
		browserWs.close();
		// Re-read targets
		const retry = await jsonList(wsUrl);
		target = retry.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
	}
	if (!target?.webSocketDebuggerUrl) throw new Error("No page target available");
	const ws = await connectCdp(target.webSocketDebuggerUrl);
	const page: CdpPage = { ws, nextId: 1, pending: new Map(), url: target.url };
	wirePage(page);
	await cdpCall(ws, "Page.enable");
	session = {
		process: processHandle,
		userDataDir,
		page,
	};
}

function cdpCall(page: CdpPage | WebSocket, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
	if (page instanceof WebSocket) {
		return new Promise((resolve, reject) => {
			const id = Math.floor(Math.random() * 1_000_000) + 1;
			const handler = (event: MessageEvent) => {
				const data = JSON.parse(String(event.data)) as {
					id?: number;
					error?: { message: string };
					result?: unknown;
				};
				if (data.id !== id) return;
				page.removeEventListener("message", handler);
				if (data.error) reject(new Error(data.error.message));
				else resolve(data.result);
			};
			page.addEventListener("message", handler);
			page.send(JSON.stringify({ id, method, params }));
		});
	}
	const id = page.nextId++;
	return new Promise((resolve, reject) => {
		page.pending.set(id, { resolve, reject });
		page.ws.send(JSON.stringify({ id, method, params }));
	});
}

function wirePage(page: CdpPage): void {
	page.ws.addEventListener("message", (event) => {
		const data = JSON.parse(String(event.data)) as { id?: number; error?: { message: string }; result?: unknown };
		if (typeof data.id !== "number") return;
		const pending = page.pending.get(data.id);
		if (!pending) return;
		page.pending.delete(data.id);
		if (data.error) pending.reject(new Error(data.error.message));
		else pending.resolve(data.result);
	});
}

async function evalOnPage(expression: string): Promise<unknown> {
	if (!session) throw new Error("No browser session. Run browser open <url> first.");
	const result = (await cdpCall(session.page, "Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true,
	})) as { result?: { type?: string; value?: unknown }; exceptionDetails?: { text?: string } };
	if (result.exceptionDetails) {
		throw new Error(`Page JS error: ${result.exceptionDetails.text ?? "unknown"}`);
	}
	return result.result?.value;
}

async function navigate(url: string): Promise<void> {
	if (!session) throw new Error("No browser session.");
	await cdpCall(session.page, "Page.navigate", { url });
	// Give the page a moment to start loading before snapshotting.
	await delay(800);
}

async function shutdown(): Promise<void> {
	if (!session) return;
	try {
		session.page.ws.close();
	} catch {
		// ignore
	}
	session.process.kill("SIGTERM");
	try {
		rmSync(session.userDataDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
	session = undefined;
}

// ============================================================================
// Page JS snippets (serialized helpers)
// ============================================================================

function resolveElementExpression(selector: string, text: string): string {
	// Pass both as a single JSON payload via an IIFE to avoid quoting hell.
	const payload = JSON.stringify({ selector, text });
	return `(() => {
  const p = ${payload};
  const byText = (root) => {
    const els = root.querySelectorAll('a, button, [role="button"], input, textarea, select, [onclick], summary, label');
    for (const el of els) {
      const t = (el.textContent || el.value || '').trim();
      if (t && (t === p.text || t.includes(p.text))) return el;
    }
    return null;
  };
  let el = null;
  if (p.selector) { try { el = document.querySelector(p.selector); } catch (e) { el = null; } }
  if (!el && p.text) el = byText(document);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x + r.width / 2),
    y: Math.round(r.y + r.height / 2),
    tag: el.tagName.toLowerCase(),
    label: (el.textContent || el.value || '').trim().slice(0, 120)
  };
})()`;
}

const SNAPSHOT_EXPRESSION = `(() => {
  const root = document.querySelector('main, article, #content, .content, [role="main"]') || document.body;
  const text = (root.innerText || root.textContent || '').replace(/\\s+/g, ' ').trim();
  return { url: location.href, title: document.title, text: text.slice(0, 12000) };
})()`;

const TYPE_EXPRESSION = (selector: string, text: string, value: string): string => {
	const payload = JSON.stringify({ selector, text, value });
	return `(() => {
  const p = ${payload};
  const byText = (root) => {
    const els = root.querySelectorAll('input, textarea, [contenteditable="true"], select');
    for (const el of els) {
      const label = (el.placeholder || el.name || el.id || '').trim();
      if (label && (label === p.text || label.includes(p.text))) return el;
    }
    return null;
  };
  let el = null;
  if (p.selector) { try { el = document.querySelector(p.selector); } catch (e) { el = null; } }
  if (!el && p.text) el = byText(document);
  if (!el) return { ok: false, error: 'element not found' };
  el.focus();
  if (el.isContentEditable) {
    el.textContent = p.value;
  } else {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, p.value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { ok: true, tag: el.tagName.toLowerCase(), value: p.value };
})()`;
};

// ============================================================================
// Tool
// ============================================================================

const BrowserParams = Type.Object({
	action: Type.String({
		description: "open | snapshot | click | type | back | close",
	}),
	url: Type.Optional(Type.String({ description: "URL to open (open)" })),
	selector: Type.Optional(Type.String({ description: "CSS selector for the element (click/type)" })),
	text: Type.Optional(Type.String({ description: "Visible text / placeholder to find the element (click/type)" })),
	value: Type.Optional(Type.String({ description: "Text to type into the element (type)" })),
	headless: Type.Optional(Type.Boolean({ description: "Run headless (default true; false opens a visible window)" })),
});

interface BrowserDetails {
	action: string;
	url?: string;
	title?: string;
	textChars?: number;
	error?: string;
}

async function ensureBrowser(headless: boolean): Promise<void> {
	if (session) return;
	const chrome = findChromeBinary();
	if (!chrome) {
		throw new Error("Chrome/Chromium not found. Install Google Chrome or set OPENPI_CHROME_PATH to the binary path.");
	}
	const userDataDir = mkdtempSync(join(tmpdir(), "openpi-browser-"));
	const args = [
		chrome,
		`--user-data-dir=${userDataDir}`,
		"--remote-debugging-port=0",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-networking",
		"--disable-component-update",
		"--disable-sync",
		"--disable-gpu",
		"--no-sandbox",
	];
	if (headless) args.push("--headless=new");
	const child = spawn(args[0]!, args.slice(1), { stdio: "ignore" });
	child.once("error", () => {
		// launch errors surface via the ws connect timeout below
	});
	const wsUrl = await readWsUrl(userDataDir);
	try {
		await launch(wsUrl, userDataDir, child);
	} catch (error) {
		child.kill("SIGTERM");
		try {
			rmSync(userDataDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
		throw error;
	}
}

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "browser",
		label: "浏览器自动化",
		description:
			"Drive a Chrome browser over CDP (no Playwright needed): open | snapshot | click | type | back | close. click/type accept a CSS selector or visible text. Use for login flows, form filling, and pages web_fetch cannot reach. State: one browser session per agent process; close it with browser close.",
		promptSnippet:
			"Use browser for interactive/authenticated pages (login, forms, clicks); use web_fetch for plain reads.",
		parameters: BrowserParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const action = String(params.action ?? "snapshot").toLowerCase();
			try {
				if (action === "open") {
					const url = String(params.url ?? "").trim();
					if (!url) {
						return {
							content: [{ type: "text", text: "browser open requires url." }],
							details: { action, error: "missing url" } satisfies BrowserDetails,
						};
					}
					await ensureBrowser(params.headless !== false);
					await navigate(url);
					const snapshot = (await evalOnPage(SNAPSHOT_EXPRESSION)) as {
						url: string;
						title: string;
						text: string;
					};
					session!.page.url = snapshot.url;
					const text = `Opened ${snapshot.url}\nTitle: ${snapshot.title}\n\n${snapshot.text}`;
					return {
						content: [{ type: "text", text }],
						details: {
							action,
							url: snapshot.url,
							title: snapshot.title,
							textChars: snapshot.text.length,
						} satisfies BrowserDetails,
					};
				}

				if (action === "snapshot") {
					await ensureBrowser(params.headless !== false);
					const snapshot = (await evalOnPage(SNAPSHOT_EXPRESSION)) as {
						url: string;
						title: string;
						text: string;
					};
					session!.page.url = snapshot.url;
					const text = `URL: ${snapshot.url}\nTitle: ${snapshot.title}\n\n${snapshot.text}`;
					return {
						content: [{ type: "text", text }],
						details: {
							action,
							url: snapshot.url,
							title: snapshot.title,
							textChars: snapshot.text.length,
						} satisfies BrowserDetails,
					};
				}

				if (action === "click") {
					await ensureBrowser(params.headless !== false);
					const selector = params.selector ? String(params.selector) : "";
					const text = params.text ? String(params.text) : "";
					if (!selector && !text) {
						return {
							content: [{ type: "text", text: "browser click requires selector or text." }],
							details: { action, error: "missing selector/text" } satisfies BrowserDetails,
						};
					}
					const target = (await evalOnPage(resolveElementExpression(selector, text))) as {
						x: number;
						y: number;
						tag: string;
						label: string;
					} | null;
					if (!target) {
						return {
							content: [{ type: "text", text: `No element found for ${selector || `"${text}"`}.` }],
							details: { action, error: "element not found" } satisfies BrowserDetails,
						};
					}
					await cdpCall(session!.page, "Input.dispatchMouseEvent", {
						type: "mousePressed",
						x: target.x,
						y: target.y,
						button: "left",
						clickCount: 1,
					});
					await cdpCall(session!.page, "Input.dispatchMouseEvent", {
						type: "mouseReleased",
						x: target.x,
						y: target.y,
						button: "left",
						clickCount: 1,
					});
					await delay(400);
					return {
						content: [
							{ type: "text", text: `Clicked <${target.tag}> "${target.label}" at (${target.x}, ${target.y}).` },
						],
						details: { action, url: session!.page.url } satisfies BrowserDetails,
					};
				}

				if (action === "type") {
					await ensureBrowser(params.headless !== false);
					const selector = params.selector ? String(params.selector) : "";
					const text = params.text ? String(params.text) : "";
					const value = params.value !== undefined ? String(params.value) : "";
					if (!selector && !text) {
						return {
							content: [{ type: "text", text: "browser type requires selector or text (placeholder/name/id)." }],
							details: { action, error: "missing selector/text" } satisfies BrowserDetails,
						};
					}
					const result = (await evalOnPage(TYPE_EXPRESSION(selector, text, value))) as {
						ok: boolean;
						error?: string;
						tag?: string;
					};
					if (!result.ok) {
						return {
							content: [{ type: "text", text: `Type failed: ${result.error ?? "unknown"}` }],
							details: { action, error: result.error } satisfies BrowserDetails,
						};
					}
					return {
						content: [
							{
								type: "text",
								text: `Typed into <${result.tag ?? "element"}>${value ? `: ${value.slice(0, 200)}` : ""}.`,
							},
						],
						details: { action, url: session!.page.url } satisfies BrowserDetails,
					};
				}

				if (action === "back") {
					await ensureBrowser(params.headless !== false);
					await cdpCall(session!.page, "Page.navigate", { url: "javascript:history.back()" });
					await delay(800);
					return {
						content: [{ type: "text", text: "Navigated back." }],
						details: { action } satisfies BrowserDetails,
					};
				}

				if (action === "close") {
					await shutdown();
					return {
						content: [{ type: "text", text: "Browser session closed." }],
						details: { action } satisfies BrowserDetails,
					};
				}

				// eval action removed: arbitrary JS execution in the browser context is an RCE vector
				// that bypasses all security gates (the tool name is not bash/write/edit).
				return {
					content: [{ type: "text", text: `Unknown browser action: ${action}` }],
					details: { action: "invalid" } satisfies BrowserDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (/No browser session/.test(message)) {
					// allow opening without explicit session for read-only actions
				}
				return {
					content: [{ type: "text", text: `browser ${action} failed: ${message}` }],
					details: { action, error: message } satisfies BrowserDetails,
				};
			}
		},
	});
}
