import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { queryTerms } from "./context/utils.ts";
import type { CapabilityDescriptor, RiskLevel } from "./contract.ts";

function classifyRisk(name: string, description: string): { risk: RiskLevel; sideEffects: string[] } {
	const text = `${name} ${description}`.toLowerCase();
	if (/delete|remove|deploy|publish|reset|force|sudo/.test(text)) {
		return { risk: "critical", sideEffects: ["state-change"] };
	}
	if (/commit|write|edit|shell|bash/.test(text)) {
		return { risk: "high", sideEffects: ["state-change"] };
	}
	if (/fetch|web|network|search|query|agent|schedule/.test(text)) {
		return { risk: "medium", sideEffects: /fetch|web|network/.test(text) ? ["network"] : [] };
	}
	return { risk: "low", sideEffects: [] };
}

function tagsFor(text: string): string[] {
	const tags = ["code", "git", "memory", "knowledge", "web", "task", "plan", "shell", "file", "search"];
	return tags.filter((tag) => text.toLowerCase().includes(tag));
}

export function buildCapabilityRegistry(pi: ExtensionAPI): CapabilityDescriptor[] {
	const active = new Set(pi.getActiveTools());
	const tools = pi.getAllTools().map((tool) => {
		const classification = classifyRisk(tool.name, tool.description);
		return {
			id: `tool:${tool.name}`,
			kind: "tool" as const,
			name: tool.name,
			description: tool.description,
			source: `${tool.sourceInfo.source}:${tool.sourceInfo.path}`,
			active: active.has(tool.name),
			tags: tagsFor(`${tool.name} ${tool.description}`),
			risk: classification.risk,
			estimatedCost: /web|agent|plan/.test(tool.name) ? 2 : 1,
			sideEffects: classification.sideEffects,
			inputSchema: tool.parameters,
		} satisfies CapabilityDescriptor;
	});
	const commands = pi.getCommands().map((command) => {
		const classification = classifyRisk(command.name, command.description ?? "");
		return {
			id: `${command.source}:${command.name}`,
			kind: command.source === "skill" ? ("skill" as const) : ("command" as const),
			name: command.name,
			description: command.description ?? "",
			source: `${command.source}:${command.sourceInfo.path}`,
			active: true,
			tags: tagsFor(`${command.name} ${command.description ?? ""}`),
			risk: classification.risk,
			estimatedCost: command.source === "skill" ? 2 : 1,
			sideEffects: classification.sideEffects,
		} satisfies CapabilityDescriptor;
	});
	return [...tools, ...commands].sort((left, right) => left.id.localeCompare(right.id));
}

export function matchCapabilities(
	capabilities: CapabilityDescriptor[],
	query: string,
	limit = 8,
): CapabilityDescriptor[] {
	const terms = queryTerms(query);
	const riskOrder = { low: 0, medium: 1, high: 2, critical: 3 };
	const ranked = capabilities
		.map((capability) => {
			const text = `${capability.name} ${capability.description} ${capability.tags.join(" ")}`.toLowerCase();
			const score = terms.reduce((total, term) => total + (text.includes(term) ? 1 : 0), 0);
			return { capability, score };
		})
		.filter((entry) => entry.score > 0)
		.sort(
			(left, right) =>
				right.score - left.score ||
				Number(right.capability.active) - Number(left.capability.active) ||
				riskOrder[left.capability.risk] - riskOrder[right.capability.risk] ||
				left.capability.estimatedCost - right.capability.estimatedCost ||
				left.capability.id.localeCompare(right.capability.id),
		);
	const kindOrder = { tool: 0, skill: 1, command: 2 };
	const fallbackPriority = (capability: CapabilityDescriptor) =>
		/^(read|code_search|grep|find|git_status|memory_list|kb_query)$/.test(capability.name) ? 0 : 1;
	const fallback = capabilities
		.filter((capability) => capability.active && capability.risk !== "critical")
		.sort(
			(left, right) =>
				fallbackPriority(left) - fallbackPriority(right) ||
				kindOrder[left.kind] - kindOrder[right.kind] ||
				riskOrder[left.risk] - riskOrder[right.risk] ||
				left.estimatedCost - right.estimatedCost ||
				left.id.localeCompare(right.id),
		);
	return (ranked.length > 0 ? ranked.map((entry) => entry.capability) : fallback).slice(0, limit);
}
