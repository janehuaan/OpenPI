import { describe, expect, it } from "vitest";
import { loadMediaHistory, mediaErrorMessage, videoDimensions } from "./media";

describe("media helpers", () => {
	it("maps supported video presets to dimensions", () => {
		expect(videoDimensions("720p", "16:9")).toEqual({ width: 1280, height: 720 });
		expect(videoDimensions("1080p", "9:16")).toEqual({ width: 1080, height: 1920 });
	});

	it("loads valid scoped history and ignores invalid records", () => {
		const raw = JSON.stringify({
			conversation: [
				{
					id: "media-1",
					kind: "image",
					prompt: "A lake",
					model: "agnes-image-2.1-flash",
					createdAt: 10,
					status: "completed",
					settings: "2K · 16:9",
				},
				{ nope: true },
			],
		});
		expect(loadMediaHistory(raw).conversation).toHaveLength(1);
		expect(loadMediaHistory("not json")).toEqual({});
	});

	it("extracts readable provider errors", () => {
		expect(mediaErrorMessage({ message: "quota exceeded" })).toBe("quota exceeded");
		expect(mediaErrorMessage(null)).toBe("媒体生成失败");
	});
});
