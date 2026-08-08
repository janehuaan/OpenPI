import { memo, type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { nextStreamingTextOffset } from "./smooth-stream";

const STREAM_FRAME_INTERVAL_MS = 24;
const AUTO_FOLLOW_THRESHOLD_PX = 96;

/** Lightweight markdown for chat (no raw HTML). */
export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
	const { displayedText, rootRef } = useSmoothText(text);
	const blocks = useMemo(() => splitBlocks(displayedText), [displayedText]);
	return (
		<div className="md" ref={rootRef}>
			{blocks.map((block, index) => {
				if (block.type === "code") {
					return (
						<pre className="md-code" key={index}>
							<code>{block.value}</code>
						</pre>
					);
				}
				if (block.type === "list") {
					if (block.ordered) {
						return (
							<ol className="md-list md-list-ol" key={index} start={block.start}>
								{block.items.map((item, itemIndex) => (
									<li key={itemIndex}>{renderInline(item)}</li>
								))}
							</ol>
						);
					}
					return (
						<ul className="md-list" key={index}>
							{block.items.map((item, itemIndex) => (
								<li key={itemIndex}>{renderInline(item)}</li>
							))}
						</ul>
					);
				}
				if (block.type === "heading") {
					const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
					return (
						<Tag className={`md-h md-h${block.level}`} key={index}>
							{renderInline(block.value)}
						</Tag>
					);
				}
				if (block.type === "hr") {
					return <hr className="md-hr" key={index} />;
				}
				if (block.type === "quote") {
					return (
						<blockquote className="md-quote" key={index}>
							{block.lines.map((line, lineIndex) => (
								<p className="md-p" key={lineIndex}>
									{renderInline(line)}
								</p>
							))}
						</blockquote>
					);
				}
				if (block.type === "table") {
					return (
						<div className="md-table-wrap" key={index}>
							<table className="md-table">
								<thead>
									<tr>
										{block.headers.map((cell, cellIndex) => (
											<th key={cellIndex}>{renderInline(cell)}</th>
										))}
									</tr>
								</thead>
								<tbody>
									{block.rows.map((row, rowIndex) => (
										<tr key={rowIndex}>
											{row.map((cell, cellIndex) => (
												<td key={cellIndex}>{renderInline(cell)}</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					);
				}
				return (
					<p className="md-p" key={index}>
						{renderInline(block.value)}
					</p>
				);
			})}
		</div>
	);
});

function useSmoothText(text: string): { displayedText: string; rootRef: RefObject<HTMLDivElement | null> } {
	const [displayedText, setDisplayedText] = useState(text);
	const displayedTextRef = useRef(text);
	const targetTextRef = useRef(text);
	const frameRef = useRef<number | undefined>(undefined);
	const lastFrameTimeRef = useRef(0);
	const shouldFollowRef = useRef(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const tickRef = useRef<(timestamp: number) => void>(() => undefined);

	tickRef.current = (timestamp) => {
		const current = displayedTextRef.current;
		const target = targetTextRef.current;
		if (current === target) {
			frameRef.current = undefined;
			return;
		}
		if (timestamp - lastFrameTimeRef.current < STREAM_FRAME_INTERVAL_MS) {
			frameRef.current = window.requestAnimationFrame(tickRef.current);
			return;
		}

		const scrollContainer = rootRef.current?.closest<HTMLElement>(".message-scroll, .reference-feed");
		shouldFollowRef.current = Boolean(
			scrollContainer &&
				scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <=
					AUTO_FOLLOW_THRESHOLD_PX,
		);

		const nextText = target.startsWith(current)
			? target.slice(0, nextStreamingTextOffset(current.length, target, timestamp - lastFrameTimeRef.current))
			: target;
		displayedTextRef.current = nextText;
		lastFrameTimeRef.current = timestamp;
		setDisplayedText(nextText);
		frameRef.current = nextText === target ? undefined : window.requestAnimationFrame(tickRef.current);
	};

	useEffect(() => {
		targetTextRef.current = text;
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduceMotion || !text.startsWith(displayedTextRef.current)) {
			if (frameRef.current !== undefined) window.cancelAnimationFrame(frameRef.current);
			frameRef.current = undefined;
			displayedTextRef.current = text;
			setDisplayedText(text);
			return;
		}
		if (displayedTextRef.current !== text && frameRef.current === undefined) {
			lastFrameTimeRef.current = performance.now() - STREAM_FRAME_INTERVAL_MS;
			frameRef.current = window.requestAnimationFrame(tickRef.current);
		}
	}, [text]);

	useLayoutEffect(() => {
		if (!shouldFollowRef.current) return;
		shouldFollowRef.current = false;
		const scrollContainer = rootRef.current?.closest<HTMLElement>(".message-scroll, .reference-feed");
		if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
	}, [displayedText]);

	useEffect(
		() => () => {
			if (frameRef.current !== undefined) window.cancelAnimationFrame(frameRef.current);
		},
		[],
	);

	return { displayedText, rootRef };
}

type Block =
	| { type: "paragraph"; value: string }
	| { type: "code"; value: string }
	| { type: "list"; items: string[]; ordered: boolean; start?: number }
	| { type: "heading"; level: number; value: string }
	| { type: "hr" }
	| { type: "quote"; lines: string[] }
	| { type: "table"; headers: string[]; rows: string[][] };

function splitBlocks(text: string): Block[] {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const trimmed = line.trim();

		if (trimmed.startsWith("```")) {
			const fence = line.trimStart();
			const lang = fence.slice(3).trim();
			void lang;
			i += 1;
			const body: string[] = [];
			while (i < lines.length && !(lines[i] ?? "").trimStart().startsWith("```")) {
				body.push(lines[i] ?? "");
				i += 1;
			}
			if (i < lines.length) i += 1;
			blocks.push({ type: "code", value: body.join("\n") });
			continue;
		}

		// ATX headings: # .. ######
		const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
		if (headingMatch) {
			blocks.push({
				type: "heading",
				level: Math.min(6, headingMatch[1]?.length ?? 1),
				value: headingMatch[2] ?? "",
			});
			i += 1;
			continue;
		}

		// Horizontal rule
		if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
			blocks.push({ type: "hr" });
			i += 1;
			continue;
		}

		// Blockquote
		if (/^\s*>\s?/.test(line)) {
			const quoteLines: string[] = [];
			while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
				quoteLines.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
				i += 1;
			}
			blocks.push({ type: "quote", lines: quoteLines });
			continue;
		}

		// GFM table: | h1 | h2 | + | --- | --- | + body rows
		if (isTableRow(trimmed) && i + 1 < lines.length && isTableDivider(lines[i + 1] ?? "")) {
			const headers = splitTableRow(trimmed);
			i += 2; // skip header + divider
			const rows: string[][] = [];
			while (i < lines.length && isTableRow((lines[i] ?? "").trim())) {
				const cells = splitTableRow((lines[i] ?? "").trim());
				// pad/truncate to header width
				while (cells.length < headers.length) cells.push("");
				rows.push(cells.slice(0, headers.length));
				i += 1;
			}
			blocks.push({ type: "table", headers, rows });
			continue;
		}

		// Unordered list
		if (/^\s*[-*+]\s+/.test(line)) {
			const items: string[] = [];
			while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
				items.push((lines[i] ?? "").replace(/^\s*[-*+]\s+/, ""));
				i += 1;
			}
			blocks.push({ type: "list", items, ordered: false });
			continue;
		}

		// Ordered list: 1. item
		const orderedStart = /^\s*(\d+)[.)]\s+/.exec(line);
		if (orderedStart) {
			const items: string[] = [];
			const start = Number(orderedStart[1] ?? "1") || 1;
			while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i] ?? "")) {
				items.push((lines[i] ?? "").replace(/^\s*\d+[.)]\s+/, ""));
				i += 1;
			}
			blocks.push({ type: "list", items, ordered: true, start });
			continue;
		}

		if (trimmed === "") {
			i += 1;
			continue;
		}

		const para: string[] = [line];
		i += 1;
		while (
			i < lines.length &&
			(lines[i] ?? "").trim() !== "" &&
			!(lines[i] ?? "").trimStart().startsWith("```") &&
			!/^\s*[-*+]\s+/.test(lines[i] ?? "") &&
			!/^\s*\d+[.)]\s+/.test(lines[i] ?? "") &&
			!/^(#{1,6})\s+/.test((lines[i] ?? "").trim()) &&
			!/^\s*>\s?/.test(lines[i] ?? "") &&
			!/^(-{3,}|\*{3,}|_{3,})\s*$/.test((lines[i] ?? "").trim()) &&
			!(isTableRow((lines[i] ?? "").trim()) && i + 1 < lines.length && isTableDivider(lines[i + 1] ?? ""))
		) {
			para.push(lines[i] ?? "");
			i += 1;
		}
		blocks.push({ type: "paragraph", value: para.join("\n") });
	}
	return blocks.length > 0 ? blocks : [{ type: "paragraph", value: text }];
}

function isTableRow(trimmed: string): boolean {
	return trimmed.includes("|") && /^\|?.+\|.+/.test(trimmed);
}

function isTableDivider(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed.includes("-")) return false;
	// | --- | :---: | ---: |
	return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(trimmed);
}

function splitTableRow(trimmed: string): string[] {
	let row = trimmed;
	if (row.startsWith("|")) row = row.slice(1);
	if (row.endsWith("|")) row = row.slice(0, -1);
	return row.split("|").map((cell) => cell.trim());
}

function renderInline(text: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	// links [text](url), then code / bold / italic
	const pattern = /(\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
	let last = 0;
	let key = 0;
	for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
		if (match.index > last) {
			nodes.push(text.slice(last, match.index));
		}
		const token = match[0];
		const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
		if (linkMatch) {
			const href = linkMatch[2] ?? "";
			const label = linkMatch[1] ?? href;
			const safe = href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:");
			if (safe) {
				nodes.push(
					<a className="md-link" href={href} key={key++} rel="noreferrer noopener" target="_blank">
						{label}
					</a>,
				);
			} else {
				nodes.push(token);
			}
		} else if (token.startsWith("`") && token.endsWith("`")) {
			nodes.push(
				<code className="md-inline-code" key={key++}>
					{token.slice(1, -1)}
				</code>,
			);
		} else if ((token.startsWith("**") && token.endsWith("**")) || (token.startsWith("__") && token.endsWith("__"))) {
			nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
		} else {
			nodes.push(<em key={key++}>{token.slice(1, -1)}</em>);
		}
		last = match.index + token.length;
	}
	if (last < text.length) nodes.push(text.slice(last));
	return nodes;
}
