import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RpcProcessInstance, resolveRpcEntryPath } from "../../../orchestrator/src/rpc-process.ts";

describe("orchestrator RPC process", () => {
	it("resolves the coding-agent RPC entry through ESM package exports", () => {
		const entryPath = resolveRpcEntryPath();

		expect(entryPath).toMatch(/[/\\]coding-agent[/\\]dist[/\\]rpc-entry\.js$/);
		expect(existsSync(entryPath)).toBe(true);
	});

	it("opens an existing Pi session when starting the RPC process", async () => {
		const directory = mkdtempSync(join(tmpdir(), "pi-orchestrator-rpc-session-"));
		const sessionFile = join(directory, "session.jsonl");
		writeFileSync(
			sessionFile,
			`${JSON.stringify({
				type: "session",
				version: 3,
				id: "existing-session",
				timestamp: "2026-07-22T00:00:00.000Z",
				cwd: directory,
			})}\n`,
		);
		const rpcProcess = new RpcProcessInstance({ cwd: directory, mode: "work", sessionFile });

		try {
			const response = await rpcProcess.send({ type: "get_state" });
			expect(response).toMatchObject({
				type: "response",
				command: "get_state",
				success: true,
				data: { sessionId: "existing-session", sessionFile },
			});
		} finally {
			await rpcProcess.dispose();
			rmSync(directory, { recursive: true, force: true });
		}
	}, 15_000);
});
