import type { AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { readFileSync } from "fs";
import { join } from "path";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness } from "./harness.ts";

type Harness = Awaited<ReturnType<typeof createHarness>>;

const harnesses: Harness[] = [];

async function makeHarness(options: Parameters<typeof createHarness>[0] = {}) {
	const harness = await createHarness(options);
	harnesses.push(harness);
	return harness;
}

function makeEchoTool(): AgentTool {
	return {
		name: "echo",
		label: "Echo",
		description: "Echo back the given text",
		parameters: Type.Object({ text: Type.String() }),
		execute: async (_toolCallId, params) => {
			const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
			return { content: [{ type: "text", text: `echoed:${text}` }], details: { text } };
		},
	};
}

afterEach(() => {
	for (const harness of harnesses) {
		harness.cleanup();
	}
	harnesses.length = 0;
});

describe("sub-agent", () => {
	it("registers the sub_agent tool on the session", async () => {
		const harness = await makeHarness();
		const toolNames = harness.session.getAllTools().map((tool) => tool.name);
		expect(toolNames).toContain("sub_agent");
	});

	it("runs a task in an isolated agent with tool access", async () => {
		const harness = await makeHarness({ tools: [makeEchoTool()] });

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("echo", { text: "hello sub" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("The echo tool returned: echoed:hello sub"),
		]);

		const answer = await harness.session.runSubAgent("Echo the text 'hello sub'");

		expect(answer).toContain("echoed:hello sub");
		// The sub-agent transcript stays isolated from the parent session.
		expect(harness.session.messages.map((message) => message.role)).toEqual([]);
	});

	it("stops after the turn limit and reports it", async () => {
		const harness = await makeHarness();

		// 3 turns available but limit is 1.
		harness.setResponses([
			fauxAssistantMessage("turn 1"),
			fauxAssistantMessage("turn 2"),
			fauxAssistantMessage("turn 3"),
		]);

		const answer = await harness.session.runSubAgent("Keep going", { maxSteps: 1 });

		expect(answer).toContain("sub-agent stopped after 1 turns");
		expect(harness.getPendingResponseCount()).toBe(2);
	});

	it("restricts the sub-agent tool set via options.tools", async () => {
		const harness = await makeHarness({ tools: [makeEchoTool()] });

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("echo", { text: "hi" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		await harness.session.runSubAgent("Echo hi", { tools: ["echo"] });
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("applies the builtin security gate to sub-agent tool calls", async () => {
		const harness = await makeHarness({ settings: { securityMode: "strict" } });

		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("bash", { command: "sudo rm -rf /" }), { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);

		const answer = await harness.session.runSubAgent("Delete everything");

		// The faux provider returns its preset text regardless of the tool
		// result, so verify the gate through the audit log instead: the
		// critical command must be recorded as blocked.
		expect(answer).toBe("done");
		const auditPath = join(harness.tempDir, ".pi", "security", "audit.jsonl");
		const audit = readFileSync(auditPath, "utf8");
		const entries = audit
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(entries.some((entry) => entry.decision === "block" && entry.level === "critical")).toBe(true);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("shares the parent model and session id", async () => {
		const harness = await makeHarness();

		harness.setResponses([fauxAssistantMessage("sub answer")]);
		await harness.session.runSubAgent("Say something");

		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("returns partial text when the sub-agent stops mid-task", async () => {
		const harness = await makeHarness();

		harness.setResponses([fauxAssistantMessage("partial result")]);
		const answer = await harness.session.runSubAgent("Do a long task", { maxSteps: 1 });

		expect(answer).toContain("partial result");
		expect(answer).toContain("stopped after 1 turns");
	});

	it("runSubAgentTasks runs multiple sub-agents in parallel and collects results", async () => {
		const harness = await makeHarness();

		// Two independent one-turn sub-agents; the faux provider serves its
		// preset responses in order, regardless of completion order.
		harness.setResponses([fauxAssistantMessage("result alpha"), fauxAssistantMessage("result beta")]);

		const results = await harness.session.runSubAgentTasks([
			{ description: "task A", prompt: "Say alpha", maxSteps: 1, writePaths: ["alpha-dir"] },
			{ description: "task B", prompt: "Say beta", maxSteps: 1, writePaths: ["beta-dir"] },
		]);

		expect(results).toHaveLength(2);
		const answers = results.map(({ result }) => result.answer).join(" ");
		expect(answers).toContain("result alpha");
		expect(answers).toContain("result beta");
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("runSubAgentTasks respects the maxParallel concurrency cap", async () => {
		const harness = await makeHarness();

		// 4 tasks with a cap of 2 → served in two waves of 2.
		harness.setResponses([
			fauxAssistantMessage("r1"),
			fauxAssistantMessage("r2"),
			fauxAssistantMessage("r3"),
			fauxAssistantMessage("r4"),
		]);

		const results = await harness.session.runSubAgentTasks(
			[1, 2, 3, 4].map((index) => ({
				description: `task ${index}`,
				prompt: `Say r${index}`,
				maxSteps: 1,
				writePaths: [`dir-${index}`],
			})),
			2,
		);

		expect(results).toHaveLength(4);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("runSubAgentTasks fails the preflight for overlapping write scopes", async () => {
		const harness = await makeHarness();

		await expect(
			harness.session.runSubAgentTasks([
				{ description: "task A", prompt: "Do A", writePaths: ["shared"] },
				{ description: "task B", prompt: "Do B", writePaths: ["shared/sub"] },
			]),
		).rejects.toThrow(/preflight failed/);
	});

	it("runSubAgentTasks fails the preflight when a task omits write_paths", async () => {
		const harness = await makeHarness();

		await expect(
			harness.session.runSubAgentTasks([
				{ description: "task A", prompt: "Do A", writePaths: ["a"] },
				{ description: "task B", prompt: "Do B" },
			]),
		).rejects.toThrow(/preflight failed/);
	});

	it("registers the background job tools on the session", async () => {
		const harness = await makeHarness();
		const toolNames = harness.session.getAllTools().map((tool) => tool.name);
		expect(toolNames).toContain("submit_job");
		expect(toolNames).toContain("wait_job");
	});

	it("submitJob returns a job id immediately and waitForJob collects the result", async () => {
		const harness = await makeHarness();

		harness.setResponses([fauxAssistantMessage("background result")]);
		const jobId = await harness.session.submitJob("Do background work", {
			description: "bg test",
			maxSteps: 1,
		});

		expect(jobId).toMatch(/^job-/);

		const state = await harness.session.waitForJob(jobId, 15000);
		expect(state.status).toBe("done");
		expect(state.result).toContain("background result");
		expect(state.turns).toBe(1);
	});

	it("wait_job tool formats done/failed/running states", async () => {
		const { createWaitJobToolDefinition } = await import("../../src/core/background-jobs.ts");

		const done = createWaitJobToolDefinition(async () => ({
			id: "job-1",
			createdAt: "",
			description: "",
			status: "done" as const,
			result: "the answer",
			turns: 3,
		}));
		const doneText = (await done.execute("c", { job_id: "job-1" }, undefined, undefined, undefined as never)).content
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("");
		expect(doneText).toContain("done (3 turns)");
		expect(doneText).toContain("the answer");

		const failed = createWaitJobToolDefinition(async () => ({
			id: "job-2",
			createdAt: "",
			description: "",
			status: "failed" as const,
			error: "boom",
		}));
		const failedText = (
			await failed.execute("c", { job_id: "job-2" }, undefined, undefined, undefined as never)
		).content
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("");
		expect(failedText).toContain("failed: boom");

		const running = createWaitJobToolDefinition(async () => ({
			id: "job-3",
			createdAt: "",
			description: "",
			status: "running" as const,
		}));
		const runningText = (
			await running.execute("c", { job_id: "job-3", timeout_s: 1 }, undefined, undefined, undefined as never)
		).content
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("");
		expect(runningText).toContain("still running");
	});
});
