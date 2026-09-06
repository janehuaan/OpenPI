import { describe, expect, it } from "vitest";
import { computeToolSignature, normalizeToolInput, ThrashingGuardrail } from "../src/guardrail.ts";

describe("ThrashingGuardrail", () => {
	it("normalizes tool inputs into deterministic signatures", () => {
		const sig1 = computeToolSignature("bash", { command: "npm test   --run" });
		const sig2 = computeToolSignature("bash", { command: "npm test --run" });
		expect(sig1).toBe(sig2);

		const edit1 = computeToolSignature("edit", { path: "src/a.ts", targetContent: "foo" });
		const edit2 = computeToolSignature("edit", { file: "src/a.ts", targetContent: "foo " });
		expect(edit1).toBe(edit2);

		const sub1 = computeToolSignature("subagent", { agent: "scout", task: "find auth files" });
		const sub2 = computeToolSignature("subagent", { agent: "scout", prompt: "find auth files" });
		expect(sub1).toBe(sub2);
	});

	it("allows initial attempts and tracks failure counts", () => {
		const guardrail = new ThrashingGuardrail({ maxConsecutiveFailures: 3 });
		const input = { command: "cargo build" };

		// First call: allowed
		expect(guardrail.checkToolCall("bash", input).block).toBe(false);

		// Record 1st failure
		guardrail.recordToolResult("bash", input, true, "error: command not found");
		expect(guardrail.checkToolCall("bash", input).consecutiveFailures).toBe(1);
		expect(guardrail.checkToolCall("bash", input).block).toBe(false);

		// Record 2nd failure
		guardrail.recordToolResult("bash", input, true, "error: command not found");
		expect(guardrail.checkToolCall("bash", input).consecutiveFailures).toBe(2);
		expect(guardrail.checkToolCall("bash", input).block).toBe(false);

		// Record 3rd failure: reaches threshold
		guardrail.recordToolResult("bash", input, true, "error: command not found");
		const check = guardrail.checkToolCall("bash", input);
		expect(check.block).toBe(true);
		expect(check.consecutiveFailures).toBe(3);
		expect(check.reason).toContain("[Runtime Guardrail]");
		expect(check.reason).toContain("Identical action (bash) attempted 3 times");
	});

	it("resets failure counter when the tool succeeds", () => {
		const guardrail = new ThrashingGuardrail({ maxConsecutiveFailures: 3 });
		const input = { command: "npm test" };

		guardrail.recordToolResult("bash", input, true, "fail");
		guardrail.recordToolResult("bash", input, true, "fail");
		expect(guardrail.checkToolCall("bash", input).consecutiveFailures).toBe(2);

		// Successful execution
		guardrail.recordToolResult("bash", input, false);
		expect(guardrail.checkToolCall("bash", input).consecutiveFailures).toBe(0);
		expect(guardrail.checkToolCall("bash", input).block).toBe(false);
	});

	it("differentiates between distinct commands or arguments", () => {
		const guardrail = new ThrashingGuardrail({ maxConsecutiveFailures: 3 });
		const inputA = { command: "git status" };
		const inputB = { command: "git diff" };

		guardrail.recordToolResult("bash", inputA, true, "fail");
		guardrail.recordToolResult("bash", inputA, true, "fail");
		guardrail.recordToolResult("bash", inputA, true, "fail");

		expect(guardrail.checkToolCall("bash", inputA).block).toBe(true);
		// Different command should NOT be blocked
		expect(guardrail.checkToolCall("bash", inputB).block).toBe(false);
	});
});
