/**
 * web-search.ts coverage: the HTML parsing path.
 *
 * DuckDuckGo is the keyless fallback, so it is the provider most users hit and
 * the only one whose output we parse ourselves. Scraped HTML changes without
 * notice; these tests pin the shapes the parser is expected to survive.
 */

import { describe, expect, it } from "vitest";
import { decodeEntities, formatResults, parseDdgHtml, stripTags, unwrapDdgUrl } from "../src/web-search.ts";

describe("decodeEntities", () => {
	it("decodes the common named entities", () => {
		expect(decodeEntities("a &lt;b&gt; &amp; &quot;c&quot; &#39;d&#39;")).toBe(`a <b> & "c" 'd'`);
	});

	it("decodes numeric entities", () => {
		expect(decodeEntities("&#8212;")).toBe("—");
	});

	it("leaves plain text untouched", () => {
		expect(decodeEntities("nothing to decode")).toBe("nothing to decode");
	});

	it("handles an empty string", () => {
		expect(decodeEntities("")).toBe("");
	});
});

describe("stripTags", () => {
	it("removes tags and keeps the text", () => {
		expect(stripTags("<b>bold</b> and <i>italic</i>")).toBe("bold and italic");
	});

	it("decodes entities in the remaining text", () => {
		expect(stripTags("<span>a &amp; b</span>")).toBe("a & b");
	});

	it("collapses whitespace left behind by removed tags", () => {
		expect(stripTags("<p>one</p>\n\n  <p>two</p>")).toBe("one two");
	});
});

describe("unwrapDdgUrl", () => {
	it("extracts the real target from a DDG redirect", () => {
		const wrapped = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&rut=abc";
		expect(unwrapDdgUrl(wrapped)).toBe("https://example.com/docs");
	});

	it("passes a direct URL through", () => {
		expect(unwrapDdgUrl("https://example.com/page")).toBe("https://example.com/page");
	});

	it("adds a scheme to a protocol-relative URL", () => {
		expect(unwrapDdgUrl("//example.com/page")).toBe("https://example.com/page");
	});

	it("returns malformed redirect input unchanged rather than throwing", () => {
		// A %-sequence that decodeURIComponent rejects must not kill the parse.
		const malformed = "//duckduckgo.com/l/?uddg=%%%";
		expect(unwrapDdgUrl(malformed)).toBe(malformed);
	});

	it("resolves relative input against the DDG origin", () => {
		// Documented consequence of parsing with a base URL: empty input becomes
		// the DDG homepage, which parseDdgHtml then rejects for having no title.
		expect(unwrapDdgUrl("")).toBe("https://duckduckgo.com/");
		expect(unwrapDdgUrl("/settings")).toBe("https://duckduckgo.com/settings");
	});
});

describe("parseDdgHtml", () => {
	const classic = `
		<div class="result">
			<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">First &amp; best</a>
			<td class="result__snippet">A snippet about the <b>first</b> result</td>
		</div>
		<div class="result">
			<a class="result__a" href="https://example.com/two">Second result</a>
			<td class="result__snippet">Another snippet</td>
		</div>`;

	it("parses titles, unwrapped URLs and snippets", () => {
		const results = parseDdgHtml(classic, 10);
		expect(results).toHaveLength(2);
		expect(results[0]?.title).toBe("First & best");
		expect(results[0]?.url).toBe("https://example.com/one");
		expect(results[0]?.snippet).toContain("first");
		expect(results[1]?.url).toBe("https://example.com/two");
	});

	it("respects maxResults", () => {
		expect(parseDdgHtml(classic, 1)).toHaveLength(1);
	});

	it("deduplicates repeated URLs", () => {
		const duplicated = classic + classic;
		const urls = parseDdgHtml(duplicated, 10).map((result) => result.url);
		expect(new Set(urls).size).toBe(urls.length);
	});

	it("skips entries whose URL is not http(s)", () => {
		const html = `<a class="result__a" href="javascript:alert(1)">Bad</a>`;
		expect(parseDdgHtml(html, 10)).toEqual([]);
	});

	it("skips entries with an empty title", () => {
		const html = `<a class="result__a" href="https://example.com/x"></a>`;
		expect(parseDdgHtml(html, 10)).toEqual([]);
	});

	it("returns an empty array for unrelated or empty HTML", () => {
		expect(parseDdgHtml("<html><body>no results here</body></html>", 10)).toEqual([]);
		expect(parseDdgHtml("", 10)).toEqual([]);
	});

	it("does not hang on a truncated tag", () => {
		expect(() => parseDdgHtml('<a class="result__a" href="https://example.com/x', 10)).not.toThrow();
	});
});

describe("formatResults", () => {
	const results = [
		{ title: "First", url: "https://example.com/one", snippet: "about one" },
		{ title: "Second", url: "https://example.com/two", snippet: "about two" },
	];

	it("lists every result with its URL", () => {
		const text = formatResults("test query", "duckduckgo", results);
		expect(text).toContain("test query");
		expect(text).toContain("duckduckgo");
		expect(text).toContain("https://example.com/one");
		expect(text).toContain("https://example.com/two");
	});

	it("says so when there are no results, naming the provider", () => {
		const text = formatResults("nothing", "brave", []);
		expect(text).toContain("No web results");
		expect(text).toContain("brave");
	});

	it("points the model at web_fetch for full text", () => {
		expect(formatResults("q", "tavily", results)).toContain("web_fetch");
	});
});
