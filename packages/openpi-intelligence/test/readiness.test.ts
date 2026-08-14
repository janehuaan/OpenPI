import { describe, expect, it } from "vitest";
import { executionBlockReason, inferTaskIntent, isDirectResponsePrompt } from "../src/readiness.ts";

describe("inferTaskIntent", () => {
	it("classifies read-only prompts", () => {
		const intent = inferTaskIntent("What does the orchestrator package do?");
		expect(intent.kind).toBe("read-only");
	});

	it("classifies work prompts", () => {
		const intent = inferTaskIntent("Implement retry backoff for task scheduler");
		expect(intent.kind).toBe("work");
	});

	it("classifies high-risk prompts", () => {
		const intent = inferTaskIntent("Please delete production database tables");
		expect(intent.kind).toBe("high-risk");
	});
});

describe("isDirectResponsePrompt", () => {
	it("detects explicit direct response requests", () => {
		expect(isDirectResponsePrompt("Say exactly: ok")).toBe(true);
		expect(isDirectResponsePrompt("请直接回复：ok")).toBe(true);
	});

	it("keeps ordinary short questions on the intelligence path", () => {
		expect(isDirectResponsePrompt("What is 2+2?")).toBe(false);
	});

	it("keeps codebase and work prompts on the intelligence path", () => {
		expect(isDirectResponsePrompt("Fix the first token latency in packages/coding-agent")).toBe(false);
		expect(isDirectResponsePrompt("Why does test/foo.test.ts fail?")).toBe(false);
	});
});

describe("executionBlockReason", () => {
	it("blocks write tools when not ready", () => {
		const reason = executionBlockReason("write", {
			version: 1,
			id: "r1",
			intentId: "i1",
			status: "needs-context",
			goalDefined: true,
			deliverablesDefined: true,
			successCriteriaDefined: true,
			verificationDefined: true,
			planValidated: false,
			blockers: ["Need more context"],
			missingContext: ["src"],
			clarifyingQuestions: [],
			allowedToolNames: [],
			createdAt: new Date().toISOString(),
		});
		expect(reason).toBeTruthy();
	});

	it("allows read tools during investigation", () => {
		const reason = executionBlockReason("read", {
			version: 1,
			id: "r1",
			intentId: "i1",
			status: "needs-context",
			goalDefined: true,
			deliverablesDefined: true,
			successCriteriaDefined: true,
			verificationDefined: true,
			planValidated: false,
			blockers: [],
			missingContext: ["src"],
			clarifyingQuestions: [],
			allowedToolNames: [],
			createdAt: new Date().toISOString(),
		});
		expect(reason).toBeUndefined();
	});
});
