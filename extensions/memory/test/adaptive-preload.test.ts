import { describe, expect, it } from "vitest";
import {
	buildDualTrackMemoryInjection,
	extractPinnedPreferences,
	findMatchingHandbookSections,
} from "../src/adaptive-preload.ts";

describe("Dual-Track Adaptive Memory Preloader", () => {
	const sampleHandbook = `# OpenPI Knowledge Handbook

## User Preferences & Habits
- 回复偏好：优先结论，少套话
- 语言偏好：统一使用简体中文

## Platform Quirks & Build Recipes
- macOS ditto preserves symlinks for Electron app bundle <!-- src: macos.md -->
- Windows requires powershell for native path traversal

## Architecture & Conventions
- 项目采用 Vitest 进行单元测试覆盖
- 单页面应用使用 React 19 和 Vite 7
`;

	it("extracts L0 pinned preferences reliably", () => {
		const pinned = extractPinnedPreferences(sampleHandbook);
		expect(pinned.length).toBe(2);
		expect(pinned[0]).toContain("回复偏好");
		expect(pinned[1]).toContain("语言偏好");
	});

	it("finds matching handbook section based on user prompt (L1 Preloading)", () => {
		// User prompt asking about macOS packaging
		const matchedMac = findMatchingHandbookSections(
			sampleHandbook,
			"请问 macOS 上打包经常报符号链接损坏怎么解决？",
		);
		expect(matchedMac.length).toBe(1);
		expect(matchedMac[0].heading).toBe("Platform Quirks & Build Recipes");
		expect(matchedMac[0].lines.some((l) => l.includes("ditto"))).toBe(true);

		// User prompt asking about unit tests
		const matchedTest = findMatchingHandbookSections(
			sampleHandbook,
			"运行一下单元测试 vitest",
		);
		expect(matchedTest.length).toBe(1);
		expect(matchedTest[0].heading).toBe("Architecture & Conventions");
		expect(matchedTest[0].lines.some((l) => l.includes("Vitest"))).toBe(true);
	});

	it("returns empty L1 matches when prompt has no topical relevance", () => {
		const matched = findMatchingHandbookSections(
			sampleHandbook,
			"今天晚上吃什么？",
		);
		expect(matched.length).toBe(0);
	});

	it("builds complete Dual-Track injection payload", () => {
		const injected = buildDualTrackMemoryInjection({
			handbookText: sampleHandbook,
			summaryText: "- [Platform Quirks]: macOS and Windows rules\n- [Architecture]: Vitest and Vite",
			userPrompt: "准备打个 mac 应用包",
			privacyInstruction: "[Privacy Note]",
		});

		// Contains L0 (Direct)
		expect(injected).toContain("Active User Directives & Constraints (L0 Always Injected)");
		expect(injected).toContain("回复偏好");

		// Contains L1 (Preloaded topic)
		expect(injected).toContain("Contextual Handbook Knowledge (L1 Preloaded");
		expect(injected).toContain("macOS ditto preserves symlinks");

		// Contains L2 (Index)
		expect(injected).toContain("Knowledge & Skills Index (L2 On-Demand Routing)");
		expect(injected).toContain("[Privacy Note]");
	});

	it("detects correction utterance and injects explicit directive promotion notice", () => {
		const injected = buildDualTrackMemoryInjection({
			handbookText: sampleHandbook,
			summaryText: "- [Platform Quirks]: macOS rules",
			userPrompt: "纠正：以后打包应用强制使用 ditto，不要用 zip",
		});

		expect(injected).toContain("Directive Promotion Guidance");
		expect(injected).toContain("tag with `[pinned]`");
	});
});
