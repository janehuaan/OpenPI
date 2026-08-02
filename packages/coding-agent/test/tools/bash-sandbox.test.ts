import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDockerBashOperations } from "../../src/core/tools/bash.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn(), execFile: vi.fn() }));

import { spawn } from "node:child_process";
import { createLocalBashOperations } from "../../src/core/tools/bash.ts";

const spawnMock = vi.mocked(spawn);

function fakeChild() {
	const child = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter & { destroy: ReturnType<typeof vi.fn> };
		stderr: EventEmitter & { destroy: ReturnType<typeof vi.fn> };
		pid: number;
		stdin: EventEmitter;
		kill: ReturnType<typeof vi.fn>;
	};
	child.stdout = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
	child.stdout.destroy = vi.fn();
	child.stderr = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
	child.stderr.destroy = vi.fn();
	child.stdin = new EventEmitter();
	child.pid = 1234;
	child.kill = vi.fn();
	return child;
}

afterEach(() => {
	vi.clearAllMocks();
});

describe("createDockerBashOperations", () => {
	it("runs commands inside a container mounting the host cwd at /work", async () => {
		const child = fakeChild();
		spawnMock.mockReturnValue(child as never);
		const ops = createDockerBashOperations({ image: "ubuntu:24.04", cwd: "/host/proj" });

		const onData = vi.fn();
		const promise = ops.exec("ls -la", "/host/proj", { onData });

		expect(spawnMock).toHaveBeenCalledWith(
			"docker",
			["run", "--rm", "-i", "-v", "/host/proj:/work", "-w", "/work", "ubuntu:24.04", "bash", "-lc", "ls -la"],
			expect.objectContaining({ cwd: "/host/proj" }),
		);

		child.stdout.emit("data", Buffer.from("total 8\n"));
		child.emit("close", 0);
		const result = await promise;
		expect(result.exitCode).toBe(0);
		expect(onData).toHaveBeenCalledWith(Buffer.from("total 8\n"));
	});

	it("streams stderr and reports non-zero exit codes", async () => {
		const child = fakeChild();
		spawnMock.mockReturnValue(child as never);
		const ops = createDockerBashOperations({ image: "ubuntu:24.04", cwd: "/host/proj" });

		const onData = vi.fn();
		const promise = ops.exec("false", "/host/proj", { onData });
		child.stderr.emit("data", Buffer.from("docker: command not found\n"));
		child.emit("close", 1);
		const result = await promise;
		expect(result.exitCode).toBe(1);
		expect(onData).toHaveBeenCalledWith(Buffer.from("docker: command not found\n"));
	});

	it("applies timeouts by killing the container process", async () => {
		const child = fakeChild();
		child.kill = vi.fn();
		spawnMock.mockReturnValue(child as never);
		const ops = createDockerBashOperations({ image: "ubuntu:24.04", cwd: "/host/proj" });

		// timeout is in seconds; 0.005s = 5ms.
		const promise = ops.exec("sleep 100", "/host/proj", { onData: vi.fn(), timeout: 0.005 });
		await new Promise((resolve) => setTimeout(resolve, 50));
		child.emit("close", null);
		await expect(promise).rejects.toThrow(/timeout/);
	});
});

describe("local operations still work", () => {
	it("exposes the default local backend", () => {
		expect(typeof createLocalBashOperations({ shellPath: "/bin/bash" }).exec).toBe("function");
	});
});
