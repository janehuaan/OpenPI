import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpManager } from "../../src/core/mcp/mcp-manager.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const sdkEntry = join(repoRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "mcp.js");
const stdioEntry = join(repoRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "server", "stdio.js");
const zodEntry = join(repoRoot, "node_modules", "zod", "index.js");

const SERVER_SCRIPT = `
import { z } from ${JSON.stringify(`file://${zodEntry}`)};
import { McpServer } from ${JSON.stringify(`file://${sdkEntry}`)};
import { StdioServerTransport } from ${JSON.stringify(`file://${stdioEntry}`)};

const server = new McpServer({ name: "test-server", version: "1.0.0" });
server.registerTool("echo", { description: "Echo back the input", inputSchema: { text: z.string() } }, async (args) => ({
  content: [{ type: "text", text: "echo:" + args.text }],
}));
server.registerTool("fail", { description: "Always fails" }, async () => ({
  content: [{ type: "text", text: "intentional failure" }],
  isError: true,
}));
const transport = new StdioServerTransport();
await server.connect(transport);
`;

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "mcp-manager-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

describe("McpManager", () => {
	it("starts a stdio server, discovers tools, and executes them", async () => {
		const scriptPath = join(tempDir, "server.mjs");
		writeFileSync(scriptPath, SERVER_SCRIPT, "utf8");

		const manager = new McpManager(
			{
				test: { command: process.execPath, args: [scriptPath] },
			},
			tempDir,
		);
		await manager.start();

		const status = manager.getStatus();
		expect(status.configured).toBe(true);
		expect(status.loaded).toBe(true);
		expect(status.servers[0].status).toBe("connected");
		expect(status.servers[0].toolCount).toBe(2);
		expect(status.tools.sort()).toEqual(["echo", "fail"]);

		const registered = manager.getRegisteredTools();
		expect(registered).toHaveLength(2);
		const echo = registered.find((tool) => tool.definition.name === "echo");
		expect(echo).toBeDefined();
		expect(echo?.definition.description).toBe("Echo back the input");

		const result = await echo!.definition.execute("call-1", { text: "hi" }, undefined, undefined, undefined as never);
		expect(result.content).toEqual([{ type: "text", text: "echo:hi" }]);

		const fail = registered.find((tool) => tool.definition.name === "fail");
		const failResult = await fail!.definition.execute("call-1", {}, undefined, undefined, undefined as never);
		expect(failResult.content[0]).toMatchObject({ text: expect.stringContaining("intentional failure") });

		await manager.stop();
		expect(manager.getStatus().loaded).toBe(false);
	});

	it("reports errors without throwing when a server fails to start", async () => {
		const manager = new McpManager(
			{
				broken: { command: process.execPath, args: ["--non-existent-flag-xyz"] },
			},
			tempDir,
		);
		await expect(manager.start()).resolves.toBeUndefined();

		const status = manager.getStatus();
		expect(status.configured).toBe(true);
		expect(status.loaded).toBe(false);
		expect(status.servers[0].status).toBe("error");
		expect(status.servers[0].error).toBeDefined();
		expect(manager.getRegisteredTools()).toHaveLength(0);
	});

	it("is a no-op with an empty config", async () => {
		const manager = new McpManager({}, tempDir);
		await manager.start();
		expect(manager.getStatus().configured).toBe(false);
		expect(manager.getRegisteredTools()).toHaveLength(0);
	});
});
