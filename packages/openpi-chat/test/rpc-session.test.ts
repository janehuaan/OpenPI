import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSessionMap, saveSessionMap } from "../src/rpc-session.ts";

let stateDir: string;
let previousStateDir: string | undefined;

beforeEach(() => {
	stateDir = mkdtempSync(join(tmpdir(), "openpi-chat-state-"));
	previousStateDir = process.env.OPENPI_CHAT_STATE_DIR;
	process.env.OPENPI_CHAT_STATE_DIR = stateDir;
});

afterEach(() => {
	rmSync(stateDir, { recursive: true, force: true });
	if (previousStateDir === undefined) delete process.env.OPENPI_CHAT_STATE_DIR;
	else process.env.OPENPI_CHAT_STATE_DIR = previousStateDir;
});

describe("session map persistence", () => {
	it("returns an empty map when no state file exists", () => {
		expect(loadSessionMap()).toEqual({ version: 1, byChatId: {} });
	});

	it("round-trips session maps through the state file", () => {
		saveSessionMap({
			version: 1,
			byChatId: { "42": { instanceId: "inst-1", cwd: "/tmp/proj", updatedAt: "2026-01-01T00:00:00.000Z" } },
		});
		expect(existsSync(join(stateDir, "sessions.json"))).toBe(true);
		expect(loadSessionMap()).toEqual({
			version: 1,
			byChatId: { "42": { instanceId: "inst-1", cwd: "/tmp/proj", updatedAt: "2026-01-01T00:00:00.000Z" } },
		});
	});

	it("resets on corrupt state files", () => {
		writeFileSync(join(stateDir, "sessions.json"), "{not json", "utf8");
		expect(loadSessionMap()).toEqual({ version: 1, byChatId: {} });
	});
});
