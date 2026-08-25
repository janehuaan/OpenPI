/**
 * skill_search — find installed skills by keyword.
 *
 * The full skill catalog can be large; with `skillsPromptMode: "compact"` or
 * `"none"` the system prompt only carries a pointer. This tool lets the agent
 * discover skills on demand and get their file paths to read when needed.
 */

import { Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";
import { type Skill, selectRelevantSkills } from "../skills.ts";

const SkillSearchParams = Type.Object({
	query: Type.String({
		description: "Keywords to search skill names and descriptions",
	}),
	max: Type.Optional(
		Type.Number({ description: "Maximum results to return (default 8, max 30)", minimum: 1, maximum: 30 }),
	),
});

interface SkillSearchDetails {
	query: string;
	count: number;
	matches?: Array<{ name: string; path: string }>;
}

export function createSkillSearchToolDefinition(
	skills: Skill[],
): ToolDefinition<typeof SkillSearchParams, SkillSearchDetails> {
	return {
		name: "skill_search",
		label: "技能搜索",
		description:
			"Search installed skills by keyword and return their names, descriptions, and file paths. Use when a task may need specialized instructions that were not injected into the context.",
		promptSnippet: "skill_search - find installed skills by keyword when a task needs specialized instructions",
		parameters: SkillSearchParams,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const query = String(params.query ?? "").trim();
			if (!query) {
				return {
					content: [{ type: "text", text: "skill_search requires a query." }],
					details: { query, count: 0 } satisfies SkillSearchDetails,
				};
			}
			const matches = selectRelevantSkills(skills, query, params.max ?? 8);
			if (matches.length === 0) {
				return {
					content: [{ type: "text", text: `No skills match "${query}".` }],
					details: { query, count: 0 } satisfies SkillSearchDetails,
				};
			}
			const lines = [`Skills matching "${query}" (${matches.length}):`, ""];
			for (const skill of matches) {
				lines.push(`- ${skill.name}: ${skill.description}`);
				lines.push(`  ${skill.filePath}`);
			}
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					query,
					count: matches.length,
					matches: matches.map((skill) => ({ name: skill.name, path: skill.filePath })),
				} satisfies SkillSearchDetails,
			};
		},
	};
}
