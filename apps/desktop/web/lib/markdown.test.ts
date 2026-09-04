/**
 * markdown.ts coverage.
 *
 * The parser exists so assistant output never touches `innerHTML`; the tests
 * that matter most are the ones proving a hostile link or HTML-looking text
 * stays inert, plus the streaming case where a fence is still open.
 */

import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown } from "../lib/markdown.ts";

describe("blocks", () => {
	it("parses a paragraph", () => {
		const blocks = parseMarkdown("Just some text.");
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.kind).toBe("paragraph");
	});

	it("keeps a multi-line paragraph together", () => {
		const blocks = parseMarkdown("line one\nline two");
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({ kind: "paragraph" });
	});

	it("splits paragraphs on a blank line", () => {
		expect(parseMarkdown("first\n\nsecond")).toHaveLength(2);
	});

	it("parses a fenced code block with its language", () => {
		const blocks = parseMarkdown("```ts\nconst x = 1;\n```");
		expect(blocks[0]).toEqual({ kind: "fence", language: "ts", text: "const x = 1;" });
	});

	it("parses a fence with no language", () => {
		const blocks = parseMarkdown("```\nplain\n```");
		expect(blocks[0]).toMatchObject({ kind: "fence", language: undefined, text: "plain" });
	});

	it("keeps an unterminated fence as code, since streamed output is cut mid-block", () => {
		const blocks = parseMarkdown("```ts\nconst x = 1;\nconst y = 2;");
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({ kind: "fence", text: "const x = 1;\nconst y = 2;" });
	});

	it("does not treat markdown inside a fence as markup", () => {
		const blocks = parseMarkdown("```\n# not a heading\n- not a bullet\n```");
		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.kind).toBe("fence");
	});

	it("parses headings at each supported level", () => {
		const blocks = parseMarkdown("# one\n## two\n### three\n#### four");
		expect(blocks.map((block) => (block.kind === "heading" ? block.level : 0))).toEqual([1, 2, 3, 4]);
	});

	it("parses bullets with either marker", () => {
		const blocks = parseMarkdown("- dash\n* star");
		expect(blocks.every((block) => block.kind === "bullet")).toBe(true);
	});

	it("parses numbered items and keeps their marker", () => {
		const blocks = parseMarkdown("1. first\n2) second");
		expect(blocks.map((block) => (block.kind === "numbered" ? block.marker : ""))).toEqual(["1", "2"]);
	});

	it("handles an empty document", () => {
		expect(parseMarkdown("")).toEqual([]);
		expect(parseMarkdown("\n\n")).toEqual([]);
	});

	it("keeps CJK text intact", () => {
		const blocks = parseMarkdown("中文段落,带 `代码`。");
		expect(blocks[0]?.kind).toBe("paragraph");
	});
});

describe("inline spans", () => {
	it("parses inline code", () => {
		expect(parseInline("run `npm test` now")).toEqual([
			{ kind: "text", text: "run " },
			{ kind: "code", text: "npm test" },
			{ kind: "text", text: " now" },
		]);
	});

	it("parses bold", () => {
		expect(parseInline("**bold** rest")).toEqual([
			{ kind: "strong", text: "bold" },
			{ kind: "text", text: " rest" },
		]);
	});

	it("parses an http link", () => {
		expect(parseInline("see [docs](https://pi.dev/docs)")).toEqual([
			{ kind: "text", text: "see " },
			{ kind: "link", text: "docs", href: "https://pi.dev/docs" },
		]);
	});

	it("leaves a javascript: link as literal text", () => {
		// A clickable javascript: URL would be arbitrary execution in the renderer.
		const spans = parseInline("[click](javascript:alert(1))");
		expect(spans.every((span) => span.kind === "text")).toBe(true);
	});

	it("leaves a file: link as literal text", () => {
		const spans = parseInline("[open](file:///etc/passwd)");
		expect(spans.every((span) => span.kind === "text")).toBe(true);
	});

	it("treats HTML as text, never markup", () => {
		const spans = parseInline("<script>alert(1)</script>");
		expect(spans).toEqual([{ kind: "text", text: "<script>alert(1)</script>" }]);
	});

	it("handles several spans in one line", () => {
		const spans = parseInline("`a` and **b** and [c](https://x.dev)");
		expect(spans.map((span) => span.kind)).toEqual(["code", "text", "strong", "text", "link"]);
	});

	it("leaves unmatched markers literal", () => {
		expect(parseInline("**unclosed and `also")).toEqual([{ kind: "text", text: "**unclosed and `also" }]);
	});

	it("handles an empty string", () => {
		expect(parseInline("")).toEqual([]);
	});
});
