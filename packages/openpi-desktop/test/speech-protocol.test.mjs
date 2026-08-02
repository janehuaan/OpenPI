import { describe, expect, it } from "vitest";
import { normalizeSpeechLanguage, parseSpeechHelperEvent } from "../electron/speech-protocol.mjs";

describe("native speech protocol", () => {
	it("normalizes renderer locale values", () => {
		expect(normalizeSpeechLanguage("zh-cn")).toBe("zh-CN");
		expect(normalizeSpeechLanguage("not a locale")).toBe("zh-CN");
		expect(normalizeSpeechLanguage(undefined)).toBe("zh-CN");
	});

	it("accepts only typed helper events", () => {
		expect(parseSpeechHelperEvent('{"type":"start","onDevice":true}')).toEqual({
			type: "start",
			onDevice: true,
		});
		expect(parseSpeechHelperEvent('{"type":"result","transcript":"你好","isFinal":false}')).toEqual({
			type: "result",
			transcript: "你好",
			isFinal: false,
		});
		expect(parseSpeechHelperEvent('{"type":"result","transcript":5,"isFinal":false}')).toBeUndefined();
		expect(parseSpeechHelperEvent("not-json")).toBeUndefined();
	});
});
