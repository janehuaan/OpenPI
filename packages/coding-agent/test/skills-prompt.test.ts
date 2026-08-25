import { describe, expect, it } from "vitest";
import {
	buildRelevantSkillsMessage,
	formatSkillsForPrompt,
	type Skill,
	sanitizeSkillContent,
	selectRelevantSkills,
} from "../src/core/skills.ts";

function skill(name: string, description: string, disableModelInvocation = false): Skill {
	return {
		name,
		description,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		sourceInfo: { source: "test", scope: "project", origin: "top-level", path: `/skills/${name}/SKILL.md` },
		disableModelInvocation,
	};
}

const skills = [
	skill("web-browser", "Interact with web pages by remote controlling Chrome over CDP"),
	skill("uv", "Use uv instead of pip/python/venv for python environments"),
	skill("email", "Compose and send email messages"),
	skill("hidden", "should never appear", true),
];

describe("formatSkillsForPrompt", () => {
	it("full mode includes locations (default)", () => {
		const prompt = formatSkillsForPrompt(skills, "full");
		expect(prompt).toContain("<available_skills>");
		expect(prompt).toContain("<location>/skills/web-browser/SKILL.md</location>");
		expect(prompt).not.toContain("hidden");
	});

	it("compact mode omits locations and truncates descriptions", () => {
		const long = skill("long", "x".repeat(300));
		const prompt = formatSkillsForPrompt([...skills, long], "compact");
		expect(prompt).not.toContain("<location>");
		expect(prompt).not.toContain("x".repeat(300));
		expect(prompt).toContain("<name>web-browser</name>");
	});

	it("none mode renders only a pointer", () => {
		const prompt = formatSkillsForPrompt(skills, "none");
		expect(prompt).toContain("skill_search");
		expect(prompt).not.toContain("<available_skills>");
		expect(prompt).toContain("3 skills are available");
	});

	it("returns empty string for empty skills", () => {
		expect(formatSkillsForPrompt([], "full")).toBe("");
	});
});

describe("selectRelevantSkills", () => {
	it("finds skills by keyword and skips disabled ones", () => {
		const matches = selectRelevantSkills(skills, "browse the web with a browser", 5);
		expect(matches.map((match) => match.name)).toEqual(["web-browser"]);
	});

	it("respects the max limit", () => {
		const many = [...skills, skill("browser-tools", "browser automation utilities")];
		const matches = selectRelevantSkills(many, "browser automation web", 1);
		expect(matches).toHaveLength(1);
	});

	it("returns empty when nothing matches", () => {
		expect(selectRelevantSkills(skills, "zzz nothing here", 5)).toEqual([]);
	});

	it("requires minimum score of 2 to match", () => {
		// "remove" only matches the description word in one skill → score=1, should be filtered out
		const singleMatch = selectRelevantSkills(skills, "remove file", 5);
		expect(singleMatch).toEqual([]);
	});

	it("matches when score reaches threshold", () => {
		// "web browser chrome" hits "web-browser" at score=3 (web+browser+chrome)
		const matches = selectRelevantSkills(skills, "web browser chrome", 5);
		expect(matches.map((m) => m.name)).toContain("web-browser");
	});
});

describe("sanitizeSkillContent", () => {
	it("strips lines that instruct process state mutation", () => {
		const input = [
			"# Setup instructions",
			"cd /tmp && source setup.sh",
			"export PATH=/opt/custom/bin:$PATH",
			"This is a normal instruction line.",
			"eval $(some-command)",
			"npm install lodash to set up the environment.",
			"Done.",
		].join("\n");
		const result = sanitizeSkillContent(input);
		expect(result).not.toContain("cd /tmp");
		expect(result).not.toContain("export PATH");
		expect(result).not.toContain("eval");
		expect(result).not.toContain("npm install");
		expect(result).toContain("Setup instructions");
		expect(result).toContain("normal instruction");
		expect(result).toContain("Done.");
	});

	it("preserves comments and blank lines", () => {
		const input = "# Comment line\n\nNormal text\n## Another comment";
		expect(sanitizeSkillContent(input)).toBe(input);
	});

	it("handles empty input gracefully", () => {
		expect(sanitizeSkillContent("")).toBe("");
		expect(sanitizeSkillContent("   ")).toBe("");
	});
});

describe("buildRelevantSkillsMessage", () => {
	it("builds a block with file paths for matches", () => {
		const body = buildRelevantSkillsMessage(skills, "help me browse the web", 5);
		expect(body).toBeDefined();
		expect(body).toContain("web-browser");
		expect(body).toContain("/skills/web-browser/SKILL.md");
	});

	it("returns undefined when nothing matches", () => {
		expect(buildRelevantSkillsMessage(skills, "unrelated topic", 5)).toBeUndefined();
	});
});
