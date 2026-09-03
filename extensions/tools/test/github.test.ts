import { describe, expect, it } from "vitest";
import { buildWeeklySummary, formatCiRuns, formatIssueList, formatPrList } from "../src/github.ts";

describe("formatPrList", () => {
	it("formats open PRs", () => {
		const text = formatPrList("o/r", [
			{ number: 1, title: "Fix bug", user: { login: "alice" } },
			{ number: 2, title: "WIP", user: { login: "bob" }, draft: true },
		]);
		expect(text).toContain("#1 Fix bug @alice");
		expect(text).toContain("#2 WIP [draft] @bob");
	});

	it("handles empty", () => {
		expect(formatPrList("o/r", [])).toContain("no open PRs");
	});
});

describe("formatIssueList", () => {
	it("formats issues with labels", () => {
		const text = formatIssueList("o/r", [
			{ number: 3, title: "Crash", user: { login: "carol" }, labels: [{ name: "bug" }] },
		]);
		expect(text).toContain("#3 Crash [bug] @carol");
	});
});

describe("formatCiRuns", () => {
	it("formats workflow runs", () => {
		const text = formatCiRuns("o/r", [
			{ id: 9, name: "CI", head_branch: "main", status: "completed", conclusion: "success" },
		]);
		expect(text).toContain("CI (main): success");
	});
});

describe("buildWeeklySummary", () => {
	it("summarizes repos", () => {
		const text = buildWeeklySummary([
			{ repo: "o/r", prs: [{ number: 10, title: "Feature", user: { login: "dave" } }], issues: [] },
			{ repo: "o/empty", prs: [], issues: [] },
		]);
		expect(text).toContain("# GitHub 周报");
		expect(text).toContain("> 统计：1 PR，0 issue");
		expect(text).toContain("## o/r");
		expect(text).toContain("#10 Feature @dave");
		expect(text).not.toContain("## o/empty");
	});
});
