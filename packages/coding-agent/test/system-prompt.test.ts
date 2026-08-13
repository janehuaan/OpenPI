import { describe, expect, test } from "vitest";
import type { Skill } from "../src/core/skills.ts";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Available tools:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools when snippets are provided", () => {
			const prompt = buildSystemPrompt({
				toolSnippets: {
					read: "Read file contents",
					bash: "Execute bash commands",
					edit: "Make surgical edits",
					write: "Create or overwrite files",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});

		test("instructs models to resolve pi docs and examples under absolute base paths", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain(
				"- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory",
			);
		});
	});

	describe("custom tool snippets", () => {
		test("includes custom tools in available tools section when promptSnippet is provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				toolSnippets: {
					dynamic_tool: "Run dynamic test behavior",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- dynamic_tool: Run dynamic test behavior");
		});

		test("omits custom tools from available tools section when promptSnippet is not provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).not.toContain("dynamic_tool");
		});
	});

	describe("prompt guidelines", () => {
		test("appends promptGuidelines to default guidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for project summaries."],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- Use dynamic_tool for project summaries.");
		});

		test("deduplicates and trims promptGuidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for summaries.", "  Use dynamic_tool for summaries.  ", "   "],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt.match(/- Use dynamic_tool for summaries\./g)).toHaveLength(1);
		});
	});
});

describe("buildSystemPrompt memoization", () => {
	const skills: Skill[] = [
		{
			name: "test-skill",
			description: "A test skill",
			filePath: "/skills/test-skill/SKILL.md",
			baseDir: "/skills/test-skill",
			sourceInfo: {
				path: "/skills/test-skill/SKILL.md",
				source: "test",
				scope: "temporary",
				origin: "top-level",
			},
			disableModelInvocation: false,
		},
	];
	const base = {
		selectedTools: ["read", "bash", "edit", "write"],
		toolSnippets: { read: "Read files", bash: "Run commands", edit: "Edit files", write: "Write files" },
		promptGuidelines: ["Be concise"],
		contextFiles: [{ path: "/proj/AGENTS.md", content: "rules here" }],
		skills,
		cwd: "/proj",
	};

	test("returns identical output for identical inputs (cache hit)", () => {
		const first = buildSystemPrompt({ ...base });
		const second = buildSystemPrompt({ ...base });
		expect(second).toBe(first);
	});

	test("invalidates when context file content changes", () => {
		const before = buildSystemPrompt({ ...base, contextFiles: [{ path: "/proj/AGENTS.md", content: "v1" }] });
		const after = buildSystemPrompt({ ...base, contextFiles: [{ path: "/proj/AGENTS.md", content: "v2" }] });
		expect(after).not.toBe(before);
		expect(after).toContain("v2");
		expect(before).toContain("v1");
	});

	test("invalidates when selectedTools order-independent changes", () => {
		const a = buildSystemPrompt({ ...base, selectedTools: ["read", "bash"] });
		const b = buildSystemPrompt({ ...base, selectedTools: ["bash", "read"] });
		expect(b).toBe(a);
	});

	test("invalidates when cwd changes", () => {
		const a = buildSystemPrompt({ ...base, cwd: "/proj" });
		const b = buildSystemPrompt({ ...base, cwd: "/other" });
		expect(b).not.toBe(a);
		expect(b).toContain("Current working directory: /other");
	});
});
