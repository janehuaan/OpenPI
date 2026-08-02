import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ContextCandidate } from "../../contract.ts";
import { createCandidate } from "../utils.ts";

export async function collectGitCandidates(pi: ExtensionAPI, cwd: string): Promise<ContextCandidate[]> {
	const root = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	if (root.code !== 0) return [];
	const repository = root.stdout.trim();
	const [diff, status, log] = await Promise.all([
		pi.exec("git", ["diff", "--", "."], { cwd: repository }),
		pi.exec("git", ["status", "--short"], { cwd: repository }),
		pi.exec("git", ["log", "-8", "--format=%h %s"], { cwd: repository }),
	]);
	return [
		...(diff.stdout.trim()
			? [
					createCandidate("git", "git:diff", "Current Git diff", diff.stdout.slice(0, 40_000), "git", {
						attention: true,
						recency: 1,
					}),
				]
			: []),
		...(status.stdout.trim()
			? [createCandidate("git", "git:status", "Git status", status.stdout, "git", { attention: true, recency: 1 })]
			: []),
		...(log.stdout.trim()
			? [createCandidate("git", "git:log", "Recent commits", log.stdout, "git", { recency: 0.8 })]
			: []),
	];
}
