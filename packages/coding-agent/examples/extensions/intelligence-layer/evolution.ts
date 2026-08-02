import * as fs from "node:fs";
import * as path from "node:path";
import type { IntelligenceRun } from "./contract.ts";

export interface EvolutionRecommendation {
	taskKind: string;
	runs: number;
	successRate: number;
	averageScore: number;
	recommendedCapabilities: string[];
	note: string;
}

function loadRuns(cwd: string): IntelligenceRun[] {
	const directory = path.join(cwd, ".pi", "intelligence", "runs");
	try {
		return fs
			.readdirSync(directory, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => {
				try {
					return JSON.parse(
						fs.readFileSync(path.join(directory, entry.name, "manifest.json"), "utf8"),
					) as IntelligenceRun;
				} catch {
					return undefined;
				}
			})
			.filter((run): run is IntelligenceRun => run !== undefined);
	} catch {
		return [];
	}
}

export function analyzeEvolution(cwd: string, minimumRuns = 3): EvolutionRecommendation[] {
	const groups = new Map<string, IntelligenceRun[]>();
	for (const run of loadRuns(cwd)) {
		const kind = run.intent?.kind ?? "unknown";
		groups.set(kind, [...(groups.get(kind) ?? []), run]);
	}
	const recommendations: EvolutionRecommendation[] = [];
	for (const [taskKind, runs] of groups) {
		if (runs.length < minimumRuns) continue;
		const evaluations = runs.flatMap((run) => run.evaluations ?? []);
		const passed = evaluations.filter((evaluation) => evaluation.passed);
		const capabilityCounts = new Map<string, number>();
		for (const run of runs) {
			if (
				!(
					run.workflow?.status === "completed" ||
					(run.evaluations?.some((evaluation) => evaluation.passed) ?? false)
				)
			)
				continue;
			for (const node of run.plan?.nodes ?? []) {
				for (const capability of node.capabilityIds)
					capabilityCounts.set(capability, (capabilityCounts.get(capability) ?? 0) + 1);
			}
		}
		const successRuns = runs.filter(
			(run) =>
				run.workflow?.status === "completed" || (run.evaluations?.some((evaluation) => evaluation.passed) ?? false),
		);
		recommendations.push({
			taskKind,
			runs: runs.length,
			successRate: successRuns.length / runs.length,
			averageScore:
				evaluations.length > 0
					? evaluations.reduce((sum, evaluation) => sum + evaluation.score, 0) / evaluations.length
					: 0,
			recommendedCapabilities: [...capabilityCounts.entries()]
				.sort((left, right) => right[1] - left[1])
				.slice(0, 6)
				.map(([id]) => id),
			note:
				passed.length === 0
					? "Insufficient passing evaluations; do not auto-apply this strategy."
					: "Recommendation is advisory and remains subject to readiness and approval gates.",
		});
	}
	return recommendations;
}
