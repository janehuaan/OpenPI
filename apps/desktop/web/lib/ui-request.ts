/**
 * Extension UI requests, answered from the renderer.
 *
 * An extension calling `ctx.ui.select`/`confirm`/`input` blocks its agent turn
 * until something replies. The daemon broadcasts the request as a session event
 * rather than swallowing it, so an unanswered prompt is visible instead of
 * looking like a hang — but the reply has to come from here.
 *
 * `setStatus` and `setWidget` arrive on the same channel and need no answer;
 * they are surfaced as status text.
 */

export interface UiRequest {
	id: string;
	method: string;
	/** The question. Upstream puts it in `title`; `message` is the detail line. */
	message?: string;
	detail?: string;
	placeholder?: string;
	options?: string[];
	defaultValue?: string;
}

export interface StatusUpdate {
	key: string;
	text?: string;
}

type Parsed =
	| { kind: "request"; request: UiRequest }
	| { kind: "status"; status: StatusUpdate }
	| { kind: "ignored" };

/** Methods that block the turn until answered. */
const BLOCKING = new Set(["select", "confirm", "input", "custom", "editor"]);

/**
 * Classify an `extension_ui_request` event.
 *
 * Unknown methods are ignored rather than shown: the set grows upstream, and a
 * dialog we cannot render correctly is worse than none.
 */
export function parseUiRequest(event: Record<string, unknown>): Parsed {
	if (event.type !== "extension_ui_request") return { kind: "ignored" };
	const method = typeof event.method === "string" ? event.method : "";

	if (method === "setStatus" || method === "setWidget" || method === "setFooter") {
		const key = typeof event.statusKey === "string" ? event.statusKey : (event.widgetKey as string) ?? method;
		const text = typeof event.statusText === "string" ? event.statusText : undefined;
		return { kind: "status", status: { key, text } };
	}

	if (!BLOCKING.has(method) || typeof event.id !== "string") return { kind: "ignored" };

	return {
		kind: "request",
		request: {
			id: event.id,
			method,
			message: firstString(event.title, event.message, event.prompt, event.text),
			detail: typeof event.message === "string" && event.title ? event.message : undefined,
			placeholder: firstString(event.placeholder),
			options: normalizeOptions(event.options ?? event.choices),
			defaultValue: firstString(event.defaultValue, event.prefill, event.initialValue),
		},
	};
}

/** The reply frame the pi subprocess expects on stdin. */
export function uiResponseCommand(
	request: UiRequest,
	outcome: { value?: string; confirmed?: boolean; cancelled?: boolean },
): { type: string; [key: string]: unknown } {
	return {
		type: "extension_ui_response",
		id: request.id,
		value: outcome.value,
		confirmed: outcome.confirmed,
		cancelled: outcome.cancelled,
	};
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

/** Options arrive as strings or as `{label, value}` records depending on the caller. */
function normalizeOptions(raw: unknown): string[] | undefined {
	if (!Array.isArray(raw) || raw.length === 0) return undefined;
	const out: string[] = [];
	for (const item of raw) {
		if (typeof item === "string") out.push(item);
		else if (item && typeof item === "object") {
			const record = item as { label?: unknown; value?: unknown };
			const label = typeof record.label === "string" ? record.label : undefined;
			const value = typeof record.value === "string" ? record.value : undefined;
			if (label ?? value) out.push((label ?? value)!);
		}
	}
	return out.length > 0 ? out : undefined;
}

/**
 * Strip ANSI escapes: status text from extensions often carries color codes.
 *
 * The escape byte is built with `fromCharCode` so the source stays free of
 * literal control characters, and it must be part of the pattern - matching only
 * `[33m` leaves the bare ESC behind, which renders as a stray glyph.
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export function stripAnsi(text: string): string {
	return text.replace(ANSI, "");
}
