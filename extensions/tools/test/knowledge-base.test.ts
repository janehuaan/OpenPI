import { describe, expect, it } from "vitest";
import { chunkText, scoreChunks } from "../src/knowledge-base.ts";

describe("chunkText", () => {
	it("chunks long text at sentence boundaries with overlap", () => {
		// ~1700 chars of sentences: chunks at ~1500 chars, sentence-aligned.
		const sentence = "This is a reasonably long sentence with enough words to matter for chunking tests. ";
		const text = sentence.repeat(20);
		const chunks = chunkText(text, "doc.md");
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks[0]!.source).toBe("doc.md");
		expect(chunks[0]!.chars).toBeGreaterThan(50);
		// Chunks overlap: the second chunk starts before the first ends.
		const firstEnd = text.indexOf(chunks[0]!.chunk) + chunks[0]!.chunk.length;
		const secondStart = text.indexOf(chunks[1]!.chunk);
		expect(secondStart).toBeLessThan(firstEnd);
	});

	it("skips tiny fragments", () => {
		const chunks = chunkText("hi", "short.md");
		expect(chunks).toHaveLength(0);
	});

	it("handles a single short document as one chunk", () => {
		const chunks = chunkText(
			"A short but meaningful document body with enough words to exceed the minimum chunk length of fifty characters.",
			"one.md",
		);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]!.chunk).toContain("meaningful");
	});
});

describe("scoreChunks", () => {
	it("scores chunks by keyword overlap and sorts descending", () => {
		const entries = [
			{
				id: "1",
				source: "a.md",
				chunk: "The config parser reads settings files.",
				chars: 40,
				tokens: 10,
				added: "",
			},
			{ id: "2", source: "b.md", chunk: "Testing framework setup.", chars: 25, tokens: 6, added: "" },
			{ id: "3", source: "c.md", chunk: "Unrelated note about cookies.", chars: 30, tokens: 8, added: "" },
		] as never;
		const scored = scoreChunks("config parser", entries);
		expect(scored.length).toBe(1);
		expect(scored[0]!.entry).toMatchObject({ source: "a.md" });
		expect(scored[0]!.score).toBe(2);
	});

	it("returns no matches for unrelated queries", () => {
		const entries = [
			{
				id: "1",
				source: "a.md",
				chunk: "The config parser reads settings files.",
				chars: 40,
				tokens: 10,
				added: "",
			},
		] as never;
		expect(scoreChunks("quantum physics", entries)).toHaveLength(0);
	});

	it("returns empty for empty queries", () => {
		expect(scoreChunks("  ", [])).toHaveLength(0);
	});
});
