import { describe, expect, it } from "vitest";
import { buildMonitorSummary, diffPage, diffRss, htmlToText, type MonitorWatch } from "../src/monitor.ts";

const watch = (overrides: Partial<MonitorWatch>): MonitorWatch => ({
	id: "watch-1",
	name: "test",
	url: "https://example.com/feed",
	kind: "rss",
	maxItems: 5,
	addedAt: "2026-01-01T00:00:00.000Z",
	seen: [],
	...overrides,
});

describe("htmlToText", () => {
	it("strips tags and decodes entities", () => {
		expect(htmlToText("<div><script>bad()</script>a &amp; b</div>")).toBe("a & b");
	});
});

describe("diffRss", () => {
	it("returns only unseen items", () => {
		const fresh = diffRss(
			["u1"],
			[
				{ title: "seen", url: "u1" },
				{ title: "new", url: "u2" },
			],
		);
		expect(fresh).toHaveLength(1);
		expect(fresh[0]!.title).toBe("new");
	});
});

describe("diffPage", () => {
	it("reports no change on first check, change when content differs", () => {
		const first = diffPage(undefined, "<p>hello</p>");
		expect(first.changed).toBe(false);
		const second = diffPage(first.hash, "<p>hello world</p>");
		expect(second.changed).toBe(true);
		const third = diffPage(second.hash, "<p>hello world</p>");
		expect(third.changed).toBe(false);
	});
});

describe("buildMonitorSummary", () => {
	it("renders new rss items and changed pages", () => {
		const summary = buildMonitorSummary(
			[watch({ name: "feed" }), watch({ id: "watch-2", name: "page", kind: "page" })],
			{ "watch-1": [{ title: "New post", url: "https://x.com/1" }] },
			{ "watch-2": "abc123" },
		);
		expect(summary).toContain("# 订阅监控日报");
		expect(summary).toContain("## feed");
		expect(summary).toContain("New post — https://x.com/1");
		expect(summary).toContain("## page");
		expect(summary).toContain("页面内容有更新");
	});

	it("handles no updates", () => {
		const summary = buildMonitorSummary([watch({ name: "feed" })], {}, {});
		expect(summary).toContain("本轮无更新");
	});
});
