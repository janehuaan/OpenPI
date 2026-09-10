import { describe, expect, it } from "vitest";
import { extractSwarmFromMessages, SWARM_ROLE_META } from "./swarm-types";
import type { ConversationMessage } from "../types";

describe("Swarm Types and Extraction", () => {
	it("has role metadata defined for all swarm roles", () => {
		expect(SWARM_ROLE_META.lead.label).toBe("总架构师");
		expect(SWARM_ROLE_META.coder.label).toBe("核心编码员");
		expect(SWARM_ROLE_META.tester.label).toBe("质量测试员");
		expect(SWARM_ROLE_META.auditor.label).toBe("安全审计员");
		expect(SWARM_ROLE_META.researcher.label).toBe("代码检索员");
	});

	it("extracts lead planning steps from user messages", () => {
		const messages: ConversationMessage[] = [
			{
				role: "user",
				content: "Please implement a new login API and write tests",
				timestamp: Date.now(),
			},
		];

		const workflow = extractSwarmFromMessages(messages, "claude-3-5-sonnet", false);
		expect(workflow.members.length).toBe(4);
		expect(workflow.steps.length).toBe(1);
		expect(workflow.steps[0].role).toBe("lead");
		expect(workflow.steps[0].memberId).toBe("agent-lead");
		expect(workflow.steps[0].title).toBe("需求分解与架构规划");
	});

	it("categorizes tool calls to appropriate swarm roles", () => {
		const messages: ConversationMessage[] = [
			{
				role: "assistant",
				content: "I will edit the file and run tests",
				timestamp: Date.now(),
				toolCalls: [
					{
						id: "call-1",
						name: "write_to_file",
						status: "completed",
						result: "wrote auth module",
					},
					{
						id: "call-2",
						name: "run_test_suite",
						status: "completed",
						result: "ran unit tests",
					},
					{
						id: "call-3",
						name: "guardrail_audit",
						status: "completed",
						result: "audit verified",
					},
				],
			},
		];

		const workflow = extractSwarmFromMessages(messages, "claude-3-5-sonnet", false);
		expect(workflow.steps.length).toBe(3);

		// write_to_file -> coder
		expect(workflow.steps[0].role).toBe("coder");
		expect(workflow.steps[0].memberId).toBe("agent-coder");

		// run_test_suite -> tester
		expect(workflow.steps[1].role).toBe("tester");
		expect(workflow.steps[1].memberId).toBe("agent-tester");

		// guardrail_audit -> auditor
		expect(workflow.steps[2].role).toBe("auditor");
		expect(workflow.steps[2].memberId).toBe("agent-auditor");

		const coder = workflow.members.find((m) => m.id === "agent-coder");
		expect(coder?.completedTasksCount).toBe(1);

		const tester = workflow.members.find((m) => m.id === "agent-tester");
		expect(tester?.completedTasksCount).toBe(1);

		const auditor = workflow.members.find((m) => m.id === "agent-auditor");
		expect(auditor?.completedTasksCount).toBe(1);
	});

	it("reflects active working state when isWorking is true", () => {
		const messages: ConversationMessage[] = [
			{
				role: "user",
				content: "Start processing",
				timestamp: Date.now(),
			},
		];

		const workflow = extractSwarmFromMessages(messages, "claude-3-5-sonnet", true);
		const lead = workflow.members.find((m) => m.id === "agent-lead");
		expect(lead?.status).toBe("running");
	});
});
