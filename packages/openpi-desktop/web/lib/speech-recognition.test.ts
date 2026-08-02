import { describe, expect, it } from "vitest";
import { joinSpeechText } from "./speech-recognition";

describe("speech recognition helpers", () => {
	it("joins Chinese and English speech without damaging punctuation", () => {
		expect(joinSpeechText("帮我", "检查项目")).toBe("帮我检查项目");
		expect(joinSpeechText("Please", "check this")).toBe("Please check this");
		expect(joinSpeechText("完成", "。然后测试")).toBe("完成。然后测试");
	});

	it("preserves intentional whitespace before a new dictated phrase", () => {
		expect(joinSpeechText("第一行\n", "继续输入")).toBe("第一行\n继续输入");
		expect(joinSpeechText("", "  hello  ")).toBe("hello");
	});
});
