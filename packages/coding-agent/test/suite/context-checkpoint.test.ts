import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type ContextCheckpoint,
	compactCheckpoint,
	formatCheckpoint,
	loadCheckpoint,
	saveCheckpoint,
} from "../../src/core/context-checkpoint.ts";

function makeCheckpoint(overrides: Partial<ContextCheckpoint> = {}): ContextCheckpoint {
	return {
		version: 1,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		goal: "Implement OAuth login",
		done: ["Set up OAuth provider", "Configure callback URL"],
		inProgress: ["Handle token refresh logic"],
		nextSteps: ["Write unit tests", "Deploy to staging"],
		decisions: [{ what: "Use PKCE flow", why: "Security requirement for mobile apps" }],
		issues: [
			{ message: "Token refresh timeout", recovered: false, tool: "bash" },
			{ message: "Old cache cleared", recovered: true },
		],
		criticalContext: ["src/oauth/provider.ts", "AUTH_CALLBACK_URL env var"],
		constraints: ["Must support refresh tokens", "Max 30s timeout"],
		...overrides,
	};
}

describe("context-checkpoint", () => {
	const dir = join(tmpdir(), `checkpoint-test-${Date.now()}`);

	it("saves and loads checkpoint", () => {
		const cp = makeCheckpoint();
		saveCheckpoint(dir, cp);
		const loaded = loadCheckpoint(dir);
		expect(loaded).toBeDefined();
		expect(loaded!.goal).toBe("Implement OAuth login");
		expect(loaded!.inProgress).toEqual(["Handle token refresh logic"]);
	});

	it("returns undefined for missing file", () => {
		expect(loadCheckpoint(join(dir, "nonexistent"))).toBeUndefined();
	});

	it("formatCheckpoint shows full structured output", () => {
		const cp = makeCheckpoint();
		const formatted = formatCheckpoint(cp);
		expect(formatted).toContain("Goal: Implement OAuth login");
		expect(formatted).toContain("✓ Set up OAuth provider");
		expect(formatted).toContain("● Handle token refresh logic");
		expect(formatted).toContain("→ Write unit tests");
		expect(formatted).toContain("Decisions:");
		expect(formatted).toContain("PKCE flow");
		expect(formatted).toContain("Open issues:");
		expect(formatted).toContain("Token refresh timeout");
		expect(formatted).toContain("Critical context:");
		expect(formatted).toContain("src/oauth/provider.ts");
	});

	it("compactCheckpoint returns short summary", () => {
		const cp = makeCheckpoint();
		const compact = compactCheckpoint(cp);
		expect(compact).toContain("Goal: Implement OAuth login");
		expect(compact).toContain("Current: Handle token refresh logic");
		expect(compact).toContain("Next: Write unit tests");
		expect(compact).toContain("Blockers: Token refresh timeout");
	});

	it("excludes recovered issues from compact", () => {
		const cp = makeCheckpoint({
			issues: [
				{ message: "Old issue (recovered)", recovered: true },
				{ message: "New issue (open)", recovered: false },
			],
		});
		const compact = compactCheckpoint(cp);
		expect(compact).toContain("New issue (open)");
		expect(compact).not.toContain("Old issue (recovered)");
	});

	it("handles empty state gracefully", () => {
		const cp = makeCheckpoint({
			done: [],
			inProgress: [],
			nextSteps: [],
			decisions: [],
			issues: [],
			criticalContext: [],
			constraints: [],
		});
		const formatted = formatCheckpoint(cp);
		expect(formatted).toContain("Goal: ");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});
});
