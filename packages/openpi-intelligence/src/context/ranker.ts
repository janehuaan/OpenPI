import type { ContextBudget, ContextCandidate, ContextScore, SelectedContext } from "../contract.ts";
import { estimateTokens, queryTerms } from "./utils.ts";

function bounded(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function scoreCandidate(candidate: ContextCandidate, query: string, pinned = false): ContextScore {
	const terms = queryTerms(query);
	const haystack = `${candidate.uri} ${candidate.title} ${candidate.content}`.toLowerCase();
	const matches = terms.filter((term) => haystack.includes(term));
	const lexical = terms.length === 0 ? 0 : matches.length / terms.length;
	const semantic =
		typeof candidate.metadata.semanticScore === "number" ? bounded(candidate.metadata.semanticScore) : 0;
	const symbol = terms.some((term) => candidate.metadata.symbol === term || candidate.uri.toLowerCase().includes(term))
		? 1
		: 0;
	const dependency =
		typeof candidate.metadata.dependencyDistance === "number"
			? bounded(1 - candidate.metadata.dependencyDistance / 5)
			: 0;
	const recency = typeof candidate.metadata.recency === "number" ? bounded(candidate.metadata.recency) : 0;
	const attention = pinned ? 1 : candidate.metadata.attention === true ? 0.8 : 0;
	const authority = ({ memory: 0.8, code: 0.9, git: 0.75, knowledge: 0.65, conversation: 0.7, web: 0.5 } as const)[
		candidate.source
	];
	const tokenPenalty = Math.min(0.25, candidate.estimatedTokens / 40_000);
	const total = bounded(
		semantic * 0.25 +
			lexical * 0.2 +
			symbol * 0.15 +
			dependency * 0.1 +
			recency * 0.08 +
			attention * 0.07 +
			authority * 0.15 -
			tokenPenalty,
	);
	const reasons = [
		...(matches.length > 0 ? [`matched: ${matches.slice(0, 5).join(", ")}`] : []),
		...(symbol > 0 ? ["symbol/path match"] : []),
		...(pinned ? ["pinned"] : []),
	];
	return { semantic, lexical, symbol, dependency, recency, attention, authority, tokenPenalty, total, reasons };
}

export function dedupeCandidates(candidates: ContextCandidate[]): ContextCandidate[] {
	const seenContent = new Set<string>();
	const seenUri = new Set<string>();
	return candidates.filter((candidate) => {
		if (seenContent.has(candidate.contentHash) || seenUri.has(`${candidate.source}:${candidate.uri}`)) return false;
		seenContent.add(candidate.contentHash);
		seenUri.add(`${candidate.source}:${candidate.uri}`);
		return true;
	});
}

export function selectContext(
	candidates: ContextCandidate[],
	query: string,
	budget: ContextBudget,
	pinnedUris: ReadonlySet<string> = new Set(),
): SelectedContext[] {
	const available = budget.totalTokens - budget.reservedForConversation - budget.reservedForCompletion;
	const sourceUsage = new Map<string, number>();
	let total = 0;
	const ranked = dedupeCandidates(candidates)
		.map((candidate) => ({
			candidate,
			pinned: pinnedUris.has(candidate.uri),
			score: scoreCandidate(candidate, query, pinnedUris.has(candidate.uri)),
		}))
		.sort(
			(left, right) =>
				Number(right.pinned) - Number(left.pinned) ||
				right.score.total - left.score.total ||
				left.candidate.uri.localeCompare(right.candidate.uri),
		);
	const selected: SelectedContext[] = [];
	for (const entry of ranked) {
		if (selected.length >= budget.maxItems || total >= available) break;
		const sourceLimit = budget.sourceLimits[entry.candidate.source] ?? 0;
		const used = sourceUsage.get(entry.candidate.source) ?? 0;
		if (sourceLimit <= used) continue;
		const allowance = Math.min(available - total, sourceLimit - used);
		if (allowance <= 0) continue;
		let content = entry.candidate.content;
		let mode: SelectedContext["mode"] = "full";
		if (entry.candidate.estimatedTokens > allowance) {
			content = content.slice(0, allowance * 4);
			mode = "excerpt";
		}
		const selectedTokens = estimateTokens(content);
		selected.push({
			candidate: entry.candidate,
			score: entry.score,
			mode,
			selectedContent: content,
			selectedTokens,
			pinned: entry.pinned,
		});
		total += selectedTokens;
		sourceUsage.set(entry.candidate.source, used + selectedTokens);
	}
	return selected;
}
