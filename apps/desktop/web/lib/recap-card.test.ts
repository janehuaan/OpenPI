import { describe, expect, it } from "vitest";
import { extractRecapAndSuggestions } from "./recap";

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

		const { suggestions } = extractRecapAndSuggestions(text, { todos });
		expect(suggestions[0]).toBe("继续待办：编写自动化文档");
	});

	it("provides smart fallbacks when no explicit next steps in text", () => {
		const text = "全部单元测试已通过，未发现任何 regression 错误。";
		const { suggestions } = extractRecapAndSuggestions(text, { todos: [] });
		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions).toContain("运行测试用例验证改动");
	});

	it("extracts real choices when model presents alternatives (方案一/方案二)", () => {
		const text = `
针对该性能瓶颈，我们有两个可行方案：

方案一：引入内存缓存层避免重复查询
方案二：使用批量聚合接口合并请求

请问你倾向于哪种方案？
		`;
		const { suggestions } = extractRecapAndSuggestions(text);
		expect(suggestions).toContain("引入内存缓存层避免重复查询");
		expect(suggestions).toContain("使用批量聚合接口合并请求");
	});

	it("extracts numbered choices following a selection prompt", () => {
		const text = `
你可以选择以下几种方式进行配置：
1. 使用默认环境变量
2. 读取本地配置文件
3. 通过命令行参数传入
		`;
		const { suggestions } = extractRecapAndSuggestions(text);
		expect(suggestions).toContain("使用默认环境变量");
		expect(suggestions).toContain("读取本地配置文件");
		expect(suggestions).toContain("通过命令行参数传入");
	});

	it("generates action and cancel branches for confirmation questions", () => {
		const text = "方案分析完毕。是否立即开始执行代码重构？";
		const { suggestions } = extractRecapAndSuggestions(text);
		expect(suggestions).toContain("确认，开始重构");
		expect(suggestions).toContain("先不执行，查看方案细节");
	});

	it("extracts executable shell commands from markdown code blocks", () => {
		const text = `
修复完成，请执行以下命令运行测试：

\`\`\`bash
npm run test
\`\`\`
		`;
		const { suggestions } = extractRecapAndSuggestions(text);
		expect(suggestions).toContain("npm run test");
	});

	it("reflects tool execution status (file edits and errors)", () => {
		const errorResult = extractRecapAndSuggestions("执行遇到了意外情况", {
			toolCalls: [{ name: "bash", status: "error" }],
		});
		expect(errorResult.suggestions).toContain("分析并修复工具执行报错");

		const editResult = extractRecapAndSuggestions("文件已更新完毕", {
			toolCalls: [{ name: "edit", status: "completed" }],
		});
		expect(editResult.suggestions).toContain("查看 git diff 确认文件修改");
	});

	it("does not false-positive recap on preliminary or questioning sentences", () => {
		const text = `
为了实现这个功能，我们需要先梳理模块结构。
请问您需要使用 TypeScript 还是 JavaScript 开发？
		`;
		const { recap } = extractRecapAndSuggestions(text);
		expect(recap).toBe("");
	});
});
