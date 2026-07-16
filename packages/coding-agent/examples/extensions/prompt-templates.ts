/**
 * Prompt Templates Extension
 *
 * Provides reusable prompt templates for common tasks: commit messages,
 * PR descriptions, code review, changelog entries, etc.
 *
 * Usage:
 *   pi --extension examples/extensions/prompt-templates.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// Types
// ============================================================================

interface Template {
	id: string;
	name: string;
	description: string;
	prompt: string;
	category: "git" | "review" | "doc" | "general";
	variables: string[];
}

// ============================================================================
// Built-in Templates
// ============================================================================

const BUILTIN_TEMPLATES: Template[] = [
	{
		id: "commit-msg",
		name: "Commit Message",
		description: "Generate a conventional commit message from git diff.",
		prompt: `Generate a conventional commit message for these changes:\n\n{diff}\n\nUse the format: <type>(<scope>): <description>\nTypes: feat, fix, refactor, docs, chore, test, style, perf, ci, build`,
		category: "git",
		variables: ["diff"],
	},
	{
		id: "pr-description",
		name: "PR Description",
		description: "Generate a PR description from git diff.",
		prompt: `Generate a PR description for the changes between {base} and {head}:\n\n{diff}\n\nInclude: Summary, Changes, Testing, Breaking Changes (if any).`,
		category: "git",
		variables: ["base", "head", "diff"],
	},
	{
		id: "code-review",
		name: "Code Review",
		description: "Generate a code review comment.",
		prompt: `Review the following code changes and provide constructive feedback:\n\n{code}\n\nFocus on: correctness, performance, readability, security, and adherence to project conventions.`,
		category: "review",
		variables: ["code"],
	},
	{
		id: "changelog-entry",
		name: "Changelog Entry",
		description: "Generate a changelog entry from commit history.",
		prompt: `Generate changelog entries from the following commits:\n\n{commits}\n\nFormat as bullet points grouped by type (Features, Fixes, Refactors, etc.).`,
		category: "git",
		variables: ["commits"],
	},
	{
		id: "doc-summary",
		name: "Documentation Summary",
		description: "Generate a documentation summary from code.",
		prompt: `Generate a documentation summary for the following code:\n\n{code}\n\nInclude: purpose, usage, parameters, return values, and examples.`,
		category: "doc",
		variables: ["code"],
	},
	{
		id: "test-generation",
		name: "Test Generation",
		description: "Generate unit tests for a function.",
		prompt: `Generate unit tests for the following code:\n\n{code}\n\nInclude: happy path, edge cases, error handling, and boundary conditions.`,
		category: "general",
		variables: ["code"],
	},
	{
		id: "refactor-plan",
		name: "Refactoring Plan",
		description: "Generate a step-by-step refactoring plan.",
		prompt: `Create a refactoring plan for the following code:\n\n{code}\n\nInclude: identified issues, proposed changes, risk assessment, and implementation steps.`,
		category: "review",
		variables: ["code"],
	},
	{
		id: "bug-report",
		name: "Bug Report",
		description: "Generate a bug report from error logs.",
		prompt: `Generate a bug report from the following error information:\n\n{error}\n\nInclude: Steps to reproduce, Expected behavior, Actual behavior, Environment, Root cause hypothesis.`,
		category: "general",
		variables: ["error"],
	},
];

// ============================================================================
// Tools
// ============================================================================

const TemplateApplyParams = Type.Object({
	name: Type.String({ description: "Template name (e.g., 'commit-msg', 'code-review')." }),
	context: Type.Optional(Type.String({ description: "Additional context to include with the template." })),
});

const TemplateListParams = Type.Object({
	category: Type.Optional(Type.String({ description: "Filter by category: git, review, doc, general." })),
});

const TemplateCreateParams = Type.Object({
	name: Type.String({ description: "Template name." }),
	description: Type.String({ description: "Template description." }),
	prompt: Type.String({ description: "Template prompt. Use {variable} for substitution." }),
	category: Type.Optional(Type.String({ description: "Category: git, review, doc, general. Default: general." })),
});

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	// Store custom templates in session
	const customTemplates: Template[] = [];

	// --- template_apply ---
	pi.registerTool({
		name: "template_apply",
		label: "Template Apply",
		description: "Apply a prompt template with variable substitution.",
		promptSnippet: "Use template_apply to generate commit messages, PR descriptions, code reviews, etc.",
		promptGuidelines: [
			"Use template_apply for common tasks like commit messages, PR descriptions, code reviews.",
			"Templates support {variable} substitution.",
			"Use template_list to see available templates.",
		],
		parameters: TemplateApplyParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			// Find template (builtin or custom)
			const allTemplates = [...BUILTIN_TEMPLATES, ...customTemplates];
			const template = allTemplates.find((t) => t.name.toLowerCase() === params.name.toLowerCase());

			if (!template) {
				return {
					content: [{ type: "text", text: `Template not found: ${params.name}` }],
					details: { error: "not-found" },
				};
			}

			// Get context (diff, code, etc.)
			let context = params.context ?? "";

			// If no context provided, try to gather from git
			if (!context) {
				if (params.name.toLowerCase().includes("commit")) {
					const { stdout } = await pi.exec("git", ["diff", "-U3"], { cwd: ctx.cwd });
					context = stdout;
				} else if (params.name.toLowerCase().includes("pr")) {
					const { stdout } = await pi.exec("git", ["diff", "origin/main...HEAD", "-U3"], { cwd: ctx.cwd });
					context = stdout;
				} else if (params.name.toLowerCase().includes("review")) {
					const { stdout } = await pi.exec("git", ["diff", "--cached", "-U3"], { cwd: ctx.cwd });
					context = stdout;
				}
			}

			// Substitute variables
			let prompt = template.prompt;
			prompt = prompt.replace("{diff}", context);
			prompt = prompt.replace("{code}", context);
			prompt = prompt.replace("{error}", context);
			prompt = prompt.replace("{commits}", context);

			return {
				content: [{ type: "text", text: `Template: ${template.name}\n\n${prompt}` }],
				details: { template: template.name, category: template.category },
			};
		},
	});

	// --- template_list ---
	pi.registerTool({
		name: "template_list",
		label: "Template List",
		description: "List all available prompt templates.",
		promptSnippet: "Use template_list to see available templates",
		parameters: TemplateListParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const allTemplates = [...BUILTIN_TEMPLATES, ...customTemplates];
			const filtered = params.category ? allTemplates.filter((t) => t.category === params.category) : allTemplates;

			if (filtered.length === 0) {
				return { content: [{ type: "text", text: "No templates found." }], details: { count: 0 } };
			}

			const categoryIcons: Record<string, string> = {
				git: "📦",
				review: "🔍",
				doc: "📝",
				general: "📋",
			};

			const lines = filtered.map((t) => {
				const icon = categoryIcons[t.category] ?? "📋";
				return `${icon} ${t.name}: ${t.description}`;
			});

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { count: filtered.length },
			};
		},
	});

	// --- template_create ---
	pi.registerTool({
		name: "template_create",
		label: "Template Create",
		description: "Create a custom prompt template.",
		promptSnippet: "Use template_create to add custom templates",
		parameters: TemplateCreateParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const template: Template = {
				id: generateId(),
				name: params.name,
				description: params.description,
				prompt: params.prompt,
				category: (params.category ?? "general") as Template["category"],
				variables: [],
			};

			// Extract variables from prompt
			const varMatches = template.prompt.match(/\{(\w+)\}/g);
			template.variables = varMatches?.map((v) => v.slice(1, -1)) ?? [];

			customTemplates.push(template);

			return {
				content: [{ type: "text", text: `Created template: ${template.name}` }],
				details: { name: template.name, variables: template.variables },
			};
		},
	});
}

function generateId(): string {
	return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
