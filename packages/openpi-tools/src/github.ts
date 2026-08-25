/**
 * GitHub 自动化 (GitHub automation) plugin.
 *
 * One `github` tool with actions:
 *   prs      — open pull requests for a repo (or all watched repos)
 *   issues   — open issues for a repo (or all watched repos)
 *   ci       — recent Actions workflow runs for a repo
 *   comment  — post a comment on an issue/PR: repo "owner/name" number 123 "body"
 *   weekly   — 7-day summary of PRs/issues across watched repos
 *   watch    — add | list | remove repos in ~/.pi/agent/github-watch.json
 *   status   — watch list + auth state
 *
 * Auth: GITHUB_TOKEN / OPENPI_GITHUB_TOKEN in ~/.pi/agent/secrets.env (or env).
 * Without a token, read-only actions fall back to GitHub's public API limits;
 * comment requires a token.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadStateFile, saveStateFile } from "./feed-utils.ts";
import { envOrSecret } from "./secrets.ts";

const WATCH_FILE = "github-watch.json";

interface GithubWatchState {
	version: number;
	repos: string[];
}

interface PullRequest {
	number: number;
	title: string;
	user?: { login?: string };
	draft?: boolean;
	created_at?: string;
	updated_at?: string;
	html_url?: string;
}

interface Issue {
	number: number;
	title: string;
	user?: { login?: string };
	labels?: Array<{ name?: string }>;
	created_at?: string;
	html_url?: string;
}

interface WorkflowRun {
	id: number;
	name?: string;
	head_branch?: string;
	status?: string;
	conclusion?: string | null;
	created_at?: string;
	html_url?: string;
}

// ============================================================================
// State / auth
// ============================================================================

function loadWatchState(): GithubWatchState {
	return (
		loadStateFile<GithubWatchState>(WATCH_FILE) ?? {
			version: 1,
			repos: [],
		}
	);
}

function saveWatchState(state: GithubWatchState): void {
	saveStateFile(WATCH_FILE, state);
}

function githubToken(): string | undefined {
	return envOrSecret("OPENPI_GITHUB_TOKEN", "GITHUB_TOKEN");
}

// ============================================================================
// GitHub REST API
// ============================================================================

async function ghFetch<T>(
	path: string,
	signal: AbortSignal | undefined,
	options: { method?: string; body?: unknown } = {},
): Promise<T> {
	const token = githubToken();
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
		"User-Agent": "openpi-agent/1.0",
	};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (options.body !== undefined) headers["Content-Type"] = "application/json";
	const response = await fetch(`https://api.github.com${path}`, {
		method: options.method ?? "GET",
		signal,
		headers,
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
	});
	if (!response.ok) {
		const detail = await response.text().catch(() => "");
		throw new Error(`GitHub ${options.method ?? "GET"} ${path} → HTTP ${response.status}: ${detail.slice(0, 200)}`);
	}
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

function splitRepo(repo: string): { owner: string; name: string } {
	const parts = repo.split("/");
	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		throw new Error(`Invalid repo "owner/name": ${repo}`);
	}
	return { owner: parts[0]!, name: parts[1]! };
}

// ============================================================================
// Formatters (pure, unit-testable)
// ============================================================================

export function formatPrList(repo: string, prs: PullRequest[]): string {
	if (prs.length === 0) return `${repo}: no open PRs.`;
	const lines = [`# ${repo} — open PRs (${prs.length})`];
	for (const pr of prs) {
		const author = pr.user?.login ?? "?";
		const draft = pr.draft ? " [draft]" : "";
		lines.push(`- #${pr.number} ${pr.title}${draft} @${author}`);
	}
	return lines.join("\n");
}

export function formatIssueList(repo: string, issues: Issue[]): string {
	if (issues.length === 0) return `${repo}: no open issues.`;
	const lines = [`# ${repo} — open issues (${issues.length})`];
	for (const issue of issues) {
		const labels = (issue.labels ?? [])
			.map((label) => label.name)
			.filter(Boolean)
			.join(", ");
		lines.push(`- #${issue.number} ${issue.title}${labels ? ` [${labels}]` : ""} @${issue.user?.login ?? "?"}`);
	}
	return lines.join("\n");
}

export function formatCiRuns(repo: string, runs: WorkflowRun[]): string {
	if (runs.length === 0) return `${repo}: no workflow runs found.`;
	const lines = [`# ${repo} — recent workflow runs (${runs.length})`];
	for (const run of runs) {
		const conclusion = run.conclusion ?? run.status ?? "?";
		const branch = run.head_branch ? ` (${run.head_branch})` : "";
		lines.push(`- ${run.name ?? `run ${run.id}`}${branch}: ${conclusion}`);
	}
	return lines.join("\n");
}

export interface RepoWeekly {
	repo: string;
	prs: PullRequest[];
	issues: Issue[];
}

export function buildWeeklySummary(weeks: RepoWeekly[]): string {
	const lines: string[] = ["# GitHub 周报", "> 近 7 天", ""];
	let totalPrs = 0;
	let totalIssues = 0;
	for (const week of weeks) {
		if (week.prs.length === 0 && week.issues.length === 0) continue;
		totalPrs += week.prs.length;
		totalIssues += week.issues.length;
		lines.push(`## ${week.repo}`);
		if (week.prs.length > 0) {
			lines.push(`**PRs**`);
			for (const pr of week.prs) {
				lines.push(`- #${pr.number} ${pr.title} @${pr.user?.login ?? "?"}`);
			}
		}
		if (week.issues.length > 0) {
			lines.push(`**Issues**`);
			for (const issue of week.issues) {
				lines.push(`- #${issue.number} ${issue.title} @${issue.user?.login ?? "?"}`);
			}
		}
		lines.push("");
	}
	if (totalPrs + totalIssues === 0) lines.push("（近 7 天无新 PR / issue）", "");
	lines.splice(2, 0, `> 统计：${totalPrs} PR，${totalIssues} issue`, "");
	return `${lines.join("\n").trimEnd()}\n`;
}

// ============================================================================
// Tool
// ============================================================================

const GithubParams = Type.Object({
	action: Type.String({
		description: "prs | issues | ci | comment | weekly | watch | status",
	}),
	repo: Type.Optional(
		Type.String({ description: 'Repo "owner/name" (prs/issues/ci/comment); defaults to all watched repos' }),
	),
	number: Type.Optional(Type.Number({ description: "Issue/PR number (comment)" })),
	body: Type.Optional(Type.String({ description: "Comment body (comment)" })),
	watch: Type.Optional(Type.String({ description: 'Repo "owner/name" to add/remove (watch action)' })),
	per_page: Type.Optional(Type.Number({ description: "Max results (default 10)", minimum: 1, maximum: 50 })),
});

interface GithubDetails {
	action: string;
	repo?: string;
	count?: number;
	error?: string;
}

function sinceDaysAgo(days: number): string {
	const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	return date.toISOString();
}

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "github",
		label: "GitHub 自动化",
		description:
			"GitHub automation: prs | issues | ci | comment | weekly | watch | status. Read PRs/issues/CI runs, post comments, and get a 7-day weekly summary across watched repos. Token: GITHUB_TOKEN / OPENPI_GITHUB_TOKEN in ~/.pi/agent/secrets.env (comment requires one).",
		promptSnippet:
			"Use github to check PRs/issues/CI, comment on issues, or produce a weekly GitHub summary for watched repos.",
		parameters: GithubParams,
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const action = String(params.action ?? "status").toLowerCase();
			const perPage = params.per_page ?? 10;
			try {
				if (action === "status") {
					const state = loadWatchState();
					const token = githubToken();
					return {
						content: [
							{
								type: "text",
								text: [
									`Watched repos (${state.repos.length}):`,
									...state.repos.map((repo) => `  ${repo}`),
									`Auth: ${token ? "token configured" : "no token (read-only, public rate limits)"}`,
								].join("\n"),
							},
						],
						details: { action, count: state.repos.length } satisfies GithubDetails,
					};
				}

				if (action === "watch") {
					const repo = String(params.watch ?? params.repo ?? "").trim();
					if (!repo) {
						return {
							content: [{ type: "text", text: "github watch requires watch=owner/name." }],
							details: { action, error: "missing repo" } satisfies GithubDetails,
						};
					}
					splitRepo(repo);
					const state = loadWatchState();
					if (state.repos.includes(repo)) {
						state.repos = state.repos.filter((entry) => entry !== repo);
						saveWatchState(state);
						return {
							content: [{ type: "text", text: `Removed ${repo} from watch list.` }],
							details: { action, repo, count: state.repos.length } satisfies GithubDetails,
						};
					}
					state.repos.push(repo);
					saveWatchState(state);
					return {
						content: [{ type: "text", text: `Added ${repo} to watch list (${state.repos.length} total).` }],
						details: { action, repo, count: state.repos.length } satisfies GithubDetails,
					};
				}

				const state = loadWatchState();
				const repos = params.repo ? [String(params.repo).trim()] : state.repos.length > 0 ? state.repos : [];
				if (repos.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: "No repos. Pass repo=owner/name or add watched repos with github watch add owner/name.",
							},
						],
						details: { action, error: "no repos" } satisfies GithubDetails,
					};
				}

				if (action === "prs" || action === "issues") {
					const parts: string[] = [];
					let count = 0;
					for (const repo of repos) {
						const { owner, name } = splitRepo(repo);
						const data = await ghFetch<Array<PullRequest | Issue>>(
							`/repos/${owner}/${name}/${action === "prs" ? "pulls" : "issues"}?state=open&sort=updated&per_page=${perPage}`,
							signal,
						);
						const rows = action === "prs" ? (data as PullRequest[]) : (data as Issue[]);
						// /issues includes PRs; filter them out for issues view
						const filtered = action === "issues" ? rows.filter((row) => !("pull_request" in row)) : rows;
						parts.push(
							action === "prs"
								? formatPrList(repo, filtered as PullRequest[])
								: formatIssueList(repo, filtered as Issue[]),
						);
						count += filtered.length;
					}
					return {
						content: [{ type: "text", text: parts.join("\n\n") }],
						details: { action, count } satisfies GithubDetails,
					};
				}

				if (action === "ci") {
					const parts: string[] = [];
					let count = 0;
					for (const repo of repos) {
						const { owner, name } = splitRepo(repo);
						const data = await ghFetch<{ workflow_runs?: WorkflowRun[] }>(
							`/repos/${owner}/${name}/actions/runs?per_page=${perPage}`,
							signal,
						);
						const runs = data.workflow_runs ?? [];
						parts.push(formatCiRuns(repo, runs));
						count += runs.length;
					}
					return {
						content: [{ type: "text", text: parts.join("\n\n") }],
						details: { action, count } satisfies GithubDetails,
					};
				}

				if (action === "comment") {
					if (!params.repo || !params.number || !params.body) {
						return {
							content: [{ type: "text", text: "github comment requires repo, number, and body." }],
							details: { action, error: "missing repo/number/body" } satisfies GithubDetails,
						};
					}
					const { owner, name } = splitRepo(String(params.repo));
					if (!githubToken()) {
						return {
							content: [
								{
									type: "text",
									text: "github comment requires GITHUB_TOKEN / OPENPI_GITHUB_TOKEN in ~/.pi/agent/secrets.env.",
								},
							],
							details: { action, error: "no token" } satisfies GithubDetails,
						};
					}
					await ghFetch(`/repos/${owner}/${name}/issues/${params.number}/comments`, signal, {
						method: "POST",
						body: { body: String(params.body) },
					});
					return {
						content: [{ type: "text", text: `Commented on ${owner}/${name}#${params.number}.` }],
						details: { action, repo: `${owner}/${name}`, count: 1 } satisfies GithubDetails,
					};
				}

				if (action === "weekly") {
					const weeks: RepoWeekly[] = [];
					const since = sinceDaysAgo(7);
					for (const repo of repos) {
						const { owner, name } = splitRepo(repo);
						const [prs, issues] = await Promise.all([
							ghFetch<Array<PullRequest | Issue>>(
								`/repos/${owner}/${name}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}`,
								signal,
							),
							ghFetch<Array<PullRequest | Issue>>(
								`/repos/${owner}/${name}/issues?state=all&sort=updated&direction=desc&per_page=${perPage}`,
								signal,
							),
						]);
						const recentPrs = (prs as PullRequest[]).filter((pr) =>
							pr.created_at ? pr.created_at >= since : true,
						);
						const recentIssues = (issues as Issue[])
							.filter((issue) => !("pull_request" in issue))
							.filter((issue) => (issue.created_at ? issue.created_at >= since : true));
						weeks.push({ repo, prs: recentPrs, issues: recentIssues });
					}
					return {
						content: [{ type: "text", text: buildWeeklySummary(weeks) }],
						details: {
							action,
							count: weeks.reduce((sum, week) => sum + week.prs.length + week.issues.length, 0),
						} satisfies GithubDetails,
					};
				}

				return {
					content: [{ type: "text", text: `Unknown github action: ${action}` }],
					details: { action: "invalid" } satisfies GithubDetails,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text", text: `github ${action} failed: ${message}` }],
					details: { action, error: message } satisfies GithubDetails,
				};
			}
		},
	});
}
