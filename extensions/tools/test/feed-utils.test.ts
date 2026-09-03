import { describe, expect, it } from "vitest";
import { parseFeedXml } from "../src/feed-utils.ts";

describe("parseFeedXml", () => {
	it("parses RSS 2.0 items with entities and dedupes by url", () => {
		const xml = `<rss version="2.0"><channel><item>
			<title>Hello &amp; World</title><link>https://a.com/1</link><pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate>
		</item><item>
			<title>Second</title><link>https://a.com/2</link>
		</item><item>
			<title>Duplicate</title><link>https://a.com/1</link>
		</item></channel></rss>`;
		const items = parseFeedXml(xml);
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ title: "Hello & World", url: "https://a.com/1" });
		expect(items[0]!.published).toBe("Mon, 01 Jan 2026 00:00:00 GMT");
	});

	it("unwraps CDATA titles", () => {
		const xml = `<rss version="2.0"><channel><item>
			<title><![CDATA[CDATA <b>Title</b>]]></title><link>https://a.com/x</link>
		</item></channel></rss>`;
		const items = parseFeedXml(xml);
		expect(items[0]!.title).toBe("CDATA Title");
	});

	it("parses Atom entries with href links", () => {
		const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
			<entry><title>Atom one</title><link href="https://b.com/x"/><updated>2026-01-02T00:00:00Z</updated></entry>
			<entry><title>Atom two</title><link href="https://b.com/y"/></entry>
		</feed>`;
		const items = parseFeedXml(xml);
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ title: "Atom one", url: "https://b.com/x" });
	});

	it("returns empty for junk input", () => {
		expect(parseFeedXml("")).toEqual([]);
		expect(parseFeedXml("<html><body>no feed</body></html>")).toEqual([]);
	});
});
