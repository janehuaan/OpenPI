import { describe, expect, it } from "vitest";
import { buildRpcProcessArgs } from "../src/rpc-process.ts";

describe("RPC process profiles", () => {
	it("keeps the Work profile unchanged", () => {
		expect(buildRpcProcessArgs("work")).toEqual([]);
		expect(buildRpcProcessArgs("work", "/tmp/session.jsonl")).toEqual(["--session", "/tmp/session.jsonl"]);
	});

	it("adds coding tools and instructions to the Code profile", () => {
		const args = buildRpcProcessArgs("code", "/tmp/session.jsonl");

		expect(args).toContain("--tools");
		expect(args[args.indexOf("--tools") + 1]?.split(",")).toEqual([
			"read",
			"bash",
			"edit",
			"write",
			"grep",
			"find",
			"ls",
			"code_search",
			"tasks",
			"memory",
		]);
		expect(args).toContain("--append-system-prompt");
		expect(args[args.indexOf("--append-system-prompt") + 1]).toContain("Code mode is active");
		expect(args.slice(-2)).toEqual(["--session", "/tmp/session.jsonl"]);
	});
});
