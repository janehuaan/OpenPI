/**
 * Minimal markdown rendering for assistant messages.
 *
 * Returns a token list rather than HTML: the renderer builds React elements from
 * it, so model output is never handed to `innerHTML`. That is the whole reason
 * for not using a markdown library here — the ones that emit HTML strings put a
 * sanitizer on the critical path for every message.
 *
 * Scope is deliberately small: fenced code, inline code, headings, list items,
 * bold and links. Anything else stays literal text.
 */

export type Inline =
	| { kind: "text"; text: string }
	| { kind: "code"; text: string }
	| { kind: "strong"; text: string }
	| { kind: "link"; text: string; href: string };

export type Block =
	| { kind: "paragraph"; spans: Inline[] }
	| { kind: "heading"; level: number; spans: Inline[] }
	| { kind: "bullet"; spans: Inline[] }
	| { kind: "numbered"; marker: string; spans: Inline[] }
	| { kind: "fence"; language?: string; text: string };

const FENCE = /^```(\w+)?\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
	const blocks: Block[] = [];
	const lines = source.split("\n");
	let paragraph: string[] = [];

	const flush = () => {
		if (paragraph.length === 0) return;
		blocks.push({ kind: "paragraph", spans: parseInline(paragraph.join("\n")) });
		paragraph = [];
	};

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!;
		const fence = line.match(FENCE);

		if (fence) {
			flush();
			const language = fence[1];
			const body: string[] = [];
			index++;
			// An unterminated fence runs to the end rather than swallowing the rest
			// as a paragraph - streamed output is routinely cut mid-block.
			while (index < lines.length && !FENCE.test(lines[index]!)) {
				body.push(lines[index]!);
				index++;
			}
			blocks.push({ kind: "fence", language, text: body.join("\n") });
			continue;
		}

		const heading = line.match(HEADING);
		if (heading) {
			flush();
			blocks.push({ kind: "heading", level: heading[1]!.length, spans: parseInline(heading[2]!) });
			continue;
		}

		const numbered = line.match(NUMBERED);
		if (numbered) {
			flush();
			blocks.push({ kind: "numbered", marker: numbered[1]!, spans: parseInline(numbered[2]!) });
			continue;
		}

		const bullet = line.match(BULLET);
		if (bullet) {
			flush();
			blocks.push({ kind: "bullet", spans: parseInline(bullet[1]!) });
			continue;
		}

		if (line.trim() === "") {
			flush();
			continue;
		}
		paragraph.push(line);
	}

	flush();
	return blocks;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))/g;

export function parseInline(text: string): Inline[] {
	const spans: Inline[] = [];
	let cursor = 0;

	for (let match = INLINE.exec(text); match !== null; match = INLINE.exec(text)) {
		if (match.index > cursor) spans.push({ kind: "text", text: text.slice(cursor, match.index) });
		const token = match[0];

		if (token.startsWith("`")) {
			spans.push({ kind: "code", text: token.slice(1, -1) });
		} else if (token.startsWith("**")) {
			spans.push({ kind: "strong", text: token.slice(2, -2) });
		} else {
			const split = token.indexOf("](");
			const label = token.slice(1, split);
			const href = token.slice(split + 2, -1);
			// Only http(s) becomes a link; anything else stays literal so a
			// javascript: or file: URL can never be clicked.
			if (/^https?:\/\//i.test(href)) spans.push({ kind: "link", text: label, href });
			else spans.push({ kind: "text", text: token });
		}
		cursor = match.index + token.length;
	}

	if (cursor < text.length) spans.push({ kind: "text", text: text.slice(cursor) });
	return spans;
}
