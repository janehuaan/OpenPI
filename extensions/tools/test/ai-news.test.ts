import { describe, expect, it } from "vitest";
import { AI_NEWS_SOURCES, buildAiNewsDigest, filterRecent } from "../src/ai-news.ts";
import type { FeedItem } from "../src/feed-utils.ts";

const items: FeedItem[] = [
	{ title: "OpenAI release", url: "https://openai.com/1", source: "openai", published: new Date().toUTCString() },
	{ title: "Old news", url: "https://openai.com/old", source: "openai", published: "Mon, 01 Jan 2020 00:00:00 GMT" },
	{ title: "HF blog", url: "https://hf.co/1", source: "hf" },
];

describe("filterRecent", () => {
	it("keeps recent items and items without dates, drops old ones", () => {
		const recent = filterRecent(items, 1);
		expect(recent.map((item) => item.title)).toEqual(["OpenAI release", "HF blog"]);
	});

	it("returns everything when days is 0", () => {
		expect(filterRecent(items, 0)).toHaveLength(3);
	});
});

describe("buildAiNewsDigest", () => {
	it("groups by source and limits per source", () => {
		const many = [
			...items,
			{ title: "OpenAI 2", url: "https://openai.com/2", source: "openai" },
			{ title: "OpenAI 3", url: "https://openai.com/3", source: "openai" },
		];
		const digest = buildAiNewsDigest(AI_NEWS_SOURCES, many, 2);
		expect(digest).toContain("# AI 早报");
		expect(digest).toContain("## OpenAI");
		// per_source=2: "OpenAI release" and one more, not all three
		const openaiSection = digest.split("## ").find((s) => s.startsWith("OpenAI"));
		expect(openaiSection!.split("\n- ").filter((line) => line.trim()).length).toBe(3); // heading + 2 items
	});

	it("handles empty input", () => {
		const digest = buildAiNewsDigest(AI_NEWS_SOURCES, [], 5);
		expect(digest).toContain("暂无新条目");
	});
});
