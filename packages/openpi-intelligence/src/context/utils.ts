import { createHash } from "node:crypto";
import * as path from "node:path";
import type { ContextCandidate, ContextSourceKind } from "../contract.ts";

export function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

export function candidateId(source: ContextSourceKind, uri: string, content: string): string {
	return `${source}:${createHash("sha256").update(`${uri}\0${content}`).digest("hex").slice(0, 16)}`;
}

export function createCandidate(
	source: ContextSourceKind,
	uri: string,
	title: string,
	content: string,
	adapter: string,
	metadata: Record<string, string | number | boolean> = {},
): ContextCandidate {
	const normalizedUri = uri.split(path.sep).join("/");
	return {
		id: candidateId(source, normalizedUri, content),
		source,
		uri: normalizedUri,
		title,
		content,
		contentHash: createHash("sha256").update(content).digest("hex"),
		estimatedTokens: estimateTokens(content),
		metadata,
		provenance: { adapter, observedAt: new Date().toISOString() },
	};
}

const stopTerms = new Set([
	"the",
	"and",
	"for",
	"with",
	"from",
	"this",
	"that",
	"如何",
	"一个",
	"进行",
	"并且",
	"然后",
	"规划",
	"调研",
	"pi",
]);

export function queryTerms(query: string): string[] {
	return [...new Set(query.toLowerCase().match(/[A-Za-z0-9_./-]{2,}|[\p{Script=Han}]{2,}/gu) ?? [])].filter(
		(term) => !stopTerms.has(term) && !/^v?\d+(?:\.\d+)+$/.test(term),
	);
}

export function containsSecret(text: string): boolean {
	return /(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"']+/i.test(text);
}

export function isExcluded(uri: string, patterns: string[]): boolean {
	const normalized = uri.split(path.sep).join("/");
	return patterns.some((pattern) => {
		if (pattern.startsWith("*.")) return normalized.endsWith(pattern.slice(1));
		if (pattern.endsWith("/")) return normalized.includes(pattern);
		if (pattern.endsWith(".*"))
			return normalized === pattern.slice(0, -2) || normalized.startsWith(pattern.slice(0, -1));
		return normalized === pattern || normalized.endsWith(`/${pattern}`);
	});
}
