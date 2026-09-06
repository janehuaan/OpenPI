import { describe, expect, it } from "vitest";
import {
	buildLlmExtractPrompt,
	executeLlmExtract,
	parseLlmExtractResponse,
	type PendingLlmExtract,
} from "../src/llm-extract.ts";

describe("llm-extract", () => {
	it("builds prompt with existing memory summaries and exclusion instructions", () => {
		const pending: PendingLlmExtract = {
			at: new Date().toISOString(),
			turns: [
				{ role: "user", text: "我们决定改用 Fastify 框架，以后不要用 Express 了" },
				{ role: "assistant", text: "好的，已记录技术栈为 Fastify。" },
			],
			existingSummary: "project:old-stack",
		};
		const prompt = buildLlmExtractPrompt(pending);
		expect(prompt).toContain("project:old-stack");
		expect(prompt).toContain("Fastify");
		expect(prompt).toContain("User: 我们决定改用 Fastify");
	});

	it("parses structured candidate responses cleanly", () => {
		const raw = `
project:api-framework: 统一使用 Fastify 框架替代 Express
feedback:no-express: 禁止在当前项目中引入 Express
NONE
`;
		const candidates = parseLlmExtractResponse(raw);
		expect(candidates.length).toBe(2);
		expect(candidates[0]!.type).toBe("project");
		expect(candidates[0]!.key).toBe("api-framework");
		expect(candidates[0]!.summary).toBe("统一使用 Fastify 框架替代 Express");
		expect(candidates[1]!.type).toBe("feedback");
		expect(candidates[1]!.key).toBe("no-express");
	});

	it("handles NONE response by returning empty list", () => {
		expect(parseLlmExtractResponse("NONE")).toEqual([]);
		expect(parseLlmExtractResponse(" none ")).toEqual([]);
		expect(parseLlmExtractResponse("")).toEqual([]);
	});

	it("executes LLM extract with modelRegistry mock", async () => {
		const mockModel = { id: "test-model", provider: "mock" };
		const mockRegistry = {
			complete: async (_model: any, _req: any) => ({
				content: [
					{
						type: "text",
						text: "project:state-mgmt: 状态管理统一使用 Zustand，禁止直接操作内部属性\nlesson:build-cache: 首次打包前需先清除旧 dist 目录",
					},
				],
			}),
		};

		const candidates = await executeLlmExtract(
			{ modelRegistry: mockRegistry, model: mockModel },
			[
				{ role: "user", text: "状态管理我们统一用 Zustand 吧" },
				{ role: "assistant", text: "好的，已确认使用 Zustand。" },
			],
			[],
		);

		expect(candidates.length).toBe(2);
		expect(candidates[0]!.key).toBe("state-mgmt");
		expect(candidates[0]!.type).toBe("project");
		expect(candidates[1]!.key).toBe("build-cache");
		expect(candidates[1]!.type).toBe("lesson");
	});

	it("gracefully returns empty array if modelRegistry or model is missing or fails", async () => {
		const res1 = await executeLlmExtract({}, [{ role: "user", text: "hi" }], []);
		expect(res1).toEqual([]);

		const failingRegistry = {
			complete: async () => {
				throw new Error("API rate limited");
			},
		};
		const res2 = await executeLlmExtract(
			{ modelRegistry: failingRegistry, model: { id: "test" } },
			[{ role: "user", text: "hi" }],
			[],
		);
		expect(res2).toEqual([]);
	});
});
