import { describe, expect, it } from "vitest";
import { executionBlockReason, inferTaskIntent } from "../src/readiness.ts";

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
