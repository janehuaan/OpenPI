import { describe, expect, it } from "vitest";
import { extractRecapAndSuggestions } from "../components/recap-card";

describe("extractRecapAndSuggestions", () => {
	it("extracts recap and structured suggestions from markdown response", () => {
		const text = `
大文件自动结构化摘要功能已在 \`extensions/tools\` 中完整实现并验证通过。

### 一、已实现功能
1. 代码文件类树与函数提取
2. JSON 格式键值分布

### 二、建议下一步：
- 运行测试用例确认全部通过
- 尝试读取一个超过1000行的大文件
- 提交当前代码
		`;

		const { recap, suggestions } = extractRecapAndSuggestions(text);
		expect(recap).toContain("大文件自动结构化摘要功能已在");
		expect(suggestions).toContain("运行测试用例确认全部通过");
		expect(suggestions).toContain("尝试读取一个超过1000行的大文件");
		expect(suggestions).toContain("提交当前代码");
	});

	it("integrates pending todo into top recommendation", () => {
		const text = "代码重构全部完成，所有测试已通过。";
		const todos = [
			{ content: "编写自动化文档", status: "pending" },
			{ content: "架构审查", status: "completed" },
		];

		const { suggestions } = extractRecapAndSuggestions(text, todos);
		expect(suggestions[0]).toBe("继续待办：编写自动化文档");
	});

	it("provides smart fallbacks when no explicit next steps in text", () => {
		const text = "全部单元测试已通过，未发现任何 regression 错误。";
		const { suggestions } = extractRecapAndSuggestions(text, []);
		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions).toContain("运行单元测试验证");
	});
});
