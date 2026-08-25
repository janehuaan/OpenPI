import { describe, expect, it } from "vitest";
import {
	findWritePathConflicts,
	runSubAgentTask,
	runSubAgentTasks,
	SUB_AGENT_SYSTEM_PROMPT,
	SUB_AGENT_TOOL_NAME,
} from "../src/index.ts";

describe("sub-agent exports", () => {
	it("re-exports the sub-agent helpers from the package entrypoint", () => {
		expect(SUB_AGENT_TOOL_NAME).toBe("sub_agent");
		expect(SUB_AGENT_SYSTEM_PROMPT).toContain("sub-agent");
		expect(typeof findWritePathConflicts).toBe("function");
		expect(typeof runSubAgentTask).toBe("function");
		expect(typeof runSubAgentTasks).toBe("function");
	});
});
