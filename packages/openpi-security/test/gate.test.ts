import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import securityGateExtension from "../src/index.ts";

type Handler = (event: never, ctx: never) => Promise<unknown>;

interface MockApi {
	handlers: Map<string, Handler[]>;
	exec: ReturnType<typeof vi.fn>;
	appendEntries: unknown[];
	api: ExtensionAPI;
}

function makeMockApi(env: Record<string, string | undefined> = {}, flagValue?: string): MockApi {
	const handlers = new Map<string, Handler[]>();
	const exec = vi.fn(async () => ({ stdout: "", stderr: "", code: 0 }));
	const appendEntries: unknown[] = [];
	const previousEnv = { ...process.env };
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	void previousEnv;
	const api = {
		on: (event: string, handler: Handler) => {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
		registerFlag: vi.fn(),
		registerCommand: vi.fn(),
		json: undefined,
		getFlag: () => flagValue,
		appendEntry: (customType: string, data?: unknown) => {
			appendEntries.push({ customType, data });
		},
		exec,
	} as unknown as ExtensionAPI;
	return { handlers, exec, appendEntries, api };
}

async function emit(mock: MockApi, event: string, payload: never, ctx: never): Promise<unknown[]> {
	const results: unknown[] = [];
	for (const handler of mock.handlers.get(event) ?? []) {
		const result = await handler(payload, ctx);
		if (result !== undefined) results.push(result);
	}
	return results;
}

function makeCtx(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		cwd: "/tmp/test-repo",
		hasUI: true,
		ui: { select: async (_title: string, options: string[]) => options[0] },
		sessionManager: { getBranch: () => [] },
		...overrides,
	} as never;
}

function makeEvent(toolName: string, input: Record<string, unknown>) {
	return { type: "tool_call", toolName, toolCallId: "call-1", input } as never;
}

async function withGate(run: (mock: MockApi, ctx: ReturnType<typeof makeCtx>) => Promise<void>, flagValue?: string) {
	const mock = makeMockApi({ PI_CODING_AGENT_DIR: "/nonexistent" }, flagValue);
	securityGateExtension(mock.api);
	await emit(mock, "session_start", undefined as never, makeCtx() as never);
	const ctx = makeCtx();
	await run(mock, ctx);
}

async function toolCallResult(
	mock: MockApi,
	ctx: never,
	toolName: string,
	input: Record<string, unknown>,
): Promise<{ block?: boolean; reason?: string } | undefined> {
	const results = await emit(mock, "tool_call", makeEvent(toolName, input), ctx);
	return results[0] as { block?: boolean; reason?: string } | undefined;
}

afterEach(() => {
	vi.restoreAllMocks();
});

beforeEach(() => {
	delete process.env.PI_CODING_AGENT_DIR;
});

describe("openpi-security gate", () => {
	it("blocks critical commands in every mode", async () => {
		for (const mode of ["strict", "confirm", "permissive", "bypass"]) {
			await withGate(async (mock, ctx) => {
				const result = await toolCallResult(mock, ctx, "bash", { command: "rm -rf /" });
				expect(result, `mode ${mode}`).toMatchObject({ block: true });
				expect(result?.reason).toContain("CRITICAL");
			}, mode);
		}
	});

	it("blocks high commands in strict mode", async () => {
		await withGate(async (mock, ctx) => {
			const result = await toolCallResult(mock, ctx, "bash", { command: "sudo apt update" });
			expect(result).toMatchObject({ block: true });
			expect(result?.reason).toContain("strict mode");
		}, "strict");
	});

	it("allows high commands after UI confirmation in confirm mode", async () => {
		await withGate(async (mock, ctx) => {
			const result = await toolCallResult(mock, ctx, "bash", { command: "sudo apt update" });
			expect(result).toBeUndefined(); // confirmed via UI "Yes"
		});
	});

	it("blocks high commands without UI in confirm mode", async () => {
		await withGate(async (mock, _ctx) => {
			const ctx = makeCtx({ hasUI: false });
			const result = await toolCallResult(mock, ctx, "bash", { command: "sudo apt update" });
			expect(result).toMatchObject({ block: true });
			expect(result?.reason).toContain("No UI");
		});
	});

	it("denies high commands when the user says no", async () => {
		await withGate(async (mock, _ctx) => {
			const ctx = makeCtx({ ui: { select: async () => "No" } });
			const result = await toolCallResult(mock, ctx, "bash", { command: "sudo apt update" });
			expect(result).toMatchObject({ block: true });
			expect(result?.reason).toContain("Blocked");
		});
	});

	it("allows medium commands in permissive mode without confirmation", async () => {
		await withGate(async (mock, ctx) => {
			const result = await toolCallResult(mock, ctx, "bash", { command: "npm install lodash" });
			expect(result).toBeUndefined();
		}, "permissive");
	});

	it("caches medium confirmations within a session", async () => {
		await withGate(async (mock, ctx) => {
			const first = await toolCallResult(mock, ctx, "bash", { command: "npm install lodash" });
			expect(first).toBeUndefined(); // confirmed via UI "Yes"
			// Second identical call: previously confirmed -> allowed without UI.
			const noUiCtx = makeCtx({ hasUI: false });
			const second = await toolCallResult(mock, noUiCtx, "bash", { command: "npm install lodash" });
			expect(second).toBeUndefined();
		});
	});

	it("blocks writes to protected paths in strict mode", async () => {
		await withGate(async (mock, ctx) => {
			const result = await toolCallResult(mock, ctx, "write", { path: ".env" });
			expect(result).toMatchObject({ block: true });
		}, "strict");
	});

	it("allows writes to regular project paths", async () => {
		await withGate(async (mock, ctx) => {
			const result = await toolCallResult(mock, ctx, "edit", { path: "src/index.ts" });
			expect(result).toBeUndefined();
		});
	});

	it("appends audit entries for blocked calls", async () => {
		await withGate(async (mock, ctx) => {
			await toolCallResult(mock, ctx, "bash", { command: "rm -rf /" });
			const audit = mock.appendEntries.find(
				(entry) => (entry as { customType: string }).customType === "security-gate-state",
			);
			expect(audit).toBeDefined();
			const state = (audit as { data: { auditLog: Array<{ decision: string }> } }).data;
			expect(state.auditLog.some((entry) => entry.decision === "blocked")).toBe(true);
		});
	});
});
