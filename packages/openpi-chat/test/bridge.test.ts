import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPrintPrompt, runRpcPrompt } from "../src/bridge.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("../src/rpc-session.ts", () => ({
	ensureChatInstance: vi.fn(async () => "inst-1"),
	promptInstance: vi.fn(async () => "rpc answer"),
}));

import { spawn } from "node:child_process";
import { ensureChatInstance, promptInstance } from "../src/rpc-session.ts";

function fakeChild() {
	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
	};
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	return child;
}

const spawnMock = vi.mocked(spawn);

let cliPath: string;
let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "pi-cli-test-"));
	cliPath = join(tempDir, "cli.js");
	writeFileSync(cliPath, "export {}", "utf8");
});

afterEach(() => {
	vi.clearAllMocks();
	rmSync(tempDir, { recursive: true, force: true });
});

describe("runPrintPrompt", () => {
	it("spawns the pi CLI with --print and returns trimmed output", async () => {
		const child = fakeChild();
		spawnMock.mockReturnValue(child as never);
		const promise = runPrintPrompt({ prompt: "say hi", cwd: "/tmp", piCliPath: cliPath });

		expect(spawnMock).toHaveBeenCalledWith(
			process.execPath,
			[cliPath, "--print", "say hi"],
			expect.objectContaining({ cwd: "/tmp" }),
		);

		child.stdout.emit("data", Buffer.from("  hello world\n"));
		child.stderr.emit("data", Buffer.from(""));
		child.emit("close", 0);

		const result = await promise;
		expect(result).toEqual({ exitCode: 0, stdout: "hello world", stderr: "", mode: "print" });
	});

	it("passes provider and model flags", () => {
		const child = fakeChild();
		spawnMock.mockReturnValue(child as never);
		void runPrintPrompt({ prompt: "q", cwd: "/tmp", piCliPath: cliPath, provider: "openai", model: "gpt-5" });
		const args = spawnMock.mock.calls[0]?.[1] as string[];
		expect(args).toContain("--provider");
		expect(args).toContain("openai");
		expect(args).toContain("--model");
		expect(args).toContain("gpt-5");
	});

	it("resolves the non-zero exit code", async () => {
		const child = fakeChild();
		spawnMock.mockReturnValue(child as never);
		const promise = runPrintPrompt({ prompt: "q", cwd: "/tmp", piCliPath: cliPath });
		child.stdout.emit("data", Buffer.from("partial"));
		child.emit("close", 1);
		const result = await promise;
		expect(result.exitCode).toBe(1);
	});
});

describe("runRpcPrompt", () => {
	it("routes prompts through the orchestrator RPC instance", async () => {
		const result = await runRpcPrompt({ prompt: "hi", cwd: "/tmp", chatId: "42" });
		expect(ensureChatInstance).toHaveBeenCalledWith(expect.objectContaining({ chatId: "42", cwd: "/tmp" }));
		expect(promptInstance).toHaveBeenCalledWith(expect.objectContaining({ message: "hi" }));
		expect(result).toMatchObject({ exitCode: 0, stdout: "rpc answer", mode: "rpc", instanceId: "inst-1" });
	});
});
