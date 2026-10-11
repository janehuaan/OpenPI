import { describe, expect, it } from "vitest";
import { parseAnswerBrief } from "./personal-agent-blocks";

describe("parseAnswerBrief", () => {
	it("structures a long analysis reply with an explicit summary line", () => {
		const text = [
			"方案 C：找支持“无限量/高配额”的平台",
			"",
			"- 例如 Google AI Studio（免费层或极低价格，上下文窗口长达 200 万）。",
			"- 或者像 Factory 这种直接买 $100（Plus）/ $200（Max）档，个人自费很不划算。",
			"",
			"一句话总结：只要做成 $20 订阅制的 SaaS，商业逻辑决定它只能防羊毛党、保本经营。",
			"",
			"建议：自建客户端按量付费接入国产高性价比模型。",
		].join("\n");

		const brief = parseAnswerBrief(text);
		expect(brief).not.toBeNull();
		expect(brief?.isStructured).toBe(true);
		expect(brief?.tldr).toContain("$20 订阅制的 SaaS");
		expect(brief?.points.length).toBeGreaterThanOrEqual(2);
		expect(brief?.suggestions.length).toBeGreaterThanOrEqual(1);
	});

	it("returns null for short chit-chat", () => {
		expect(parseAnswerBrief("好的，我这就去办。")).toBeNull();
		expect(parseAnswerBrief("")).toBeNull();
	});

	it("structures a bullet-only reply even without a summary line", () => {
		const text = [
			"关于模型接入，我给你三个可选方案，各有取舍：",
			"1. 直接使用 Google AI Studio 的免费额度，上下文窗口足够大",
			"2. 采购高配额的 SaaS 订阅，按月结算但个人自费偏贵",
			"3. 自建客户端按量付费接入国产高性价比模型",
		].join("\n");

		const brief = parseAnswerBrief(text);
		expect(brief?.isStructured).toBe(true);
		expect(brief?.points.length).toBe(3);
	});

	it("infers a confirm status when the reply asks for approval", () => {
		const text = [
			"我已经把三个改动都准备好了，随时可以落地。",
			"- 熔断器重标定",
			"- 事件过滤修复",
			"是否开始执行这次重构？",
		].join("\n");
		expect(parseAnswerBrief(text)?.status).toBe("confirm");
	});
});
