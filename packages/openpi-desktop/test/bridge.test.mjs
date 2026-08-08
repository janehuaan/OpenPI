import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() } }));
vi.mock("../electron/agnes-media.mjs", () => ({ createAgnesMediaClient: vi.fn() }));
vi.mock("../electron/orch.mjs", () => ({
	ensureDaemon: vi.fn(async () => {}),
	getHealthSafe: vi.fn(async () => ({
		version: "0.80.8",
		uptimeMs: 100,
		socketPath: "/tmp/sock",
		sessionsIndexed: true,
	})),
	listInstancesLive: vi.fn(async () => []),
	probeDaemon: vi.fn(async () => ({ alive: true, list: { instances: [] } })),
	readTasksAndRuns: vi.fn(() => ({ tasks: [], runs: [], instances: [] })),
	restartDaemon: vi.fn(async () => {}),
	rpc: vi.fn(async () => ({})),
	sendIpcRequest: vi.fn(async () => ({ ok: true })),
	stopDaemon: vi.fn(async () => {}),
}));
vi.mock("../electron/paths.mjs", () => ({
	agentDir: () => "/tmp/agent",
	defaultWorkspace: () => "/tmp/ws",
	loadAgentSecretsEnv: () => ({}),
	nodeBinary: () => process.execPath,
	nodeSpawnEnv: () => ({ ...process.env }),
	openpiPackageFile: () => "/tmp/pkg",
	openpiPackagesRoot: () => "/tmp/pkgs",
	repoRoot: () => "/tmp/repo",
}));

import { registerBridge } from "../electron/bridge.mjs";
import {
	ensureDaemon,
	getHealthSafe,
	listInstancesLive,
	probeDaemon,
	readTasksAndRuns,
	restartDaemon,
	stopDaemon,
} from "../electron/orch.mjs";

const orch = {
	ensureDaemon: vi.mocked(ensureDaemon),
	getHealthSafe: vi.mocked(getHealthSafe),
	listInstancesLive: vi.mocked(listInstancesLive),
	probeDaemon: vi.mocked(probeDaemon),
	readTasksAndRuns: vi.mocked(readTasksAndRuns),
	restartDaemon: vi.mocked(restartDaemon),
	stopDaemon: vi.mocked(stopDaemon),
};

function makeIpcMain() {
	const handlers = new Map();
	return {
		handlers,
		handle: (channel, handler) => {
			handlers.set(channel, handler);
		},
		async call(channel, ...args) {
			const handler = handlers.get(channel);
			if (!handler) throw new Error(`no handler for ${channel}`);
			return await handler({}, ...args);
		},
	};
}

let ipcMain;

beforeEach(() => {
	ipcMain = makeIpcMain();
	registerBridge(ipcMain, () => ({}));
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("bridge IPC", () => {
	it("registers the daemon control channels", async () => {
		await ipcMain.call("openpi:start_daemon");
		expect(orch.ensureDaemon).toHaveBeenCalled();
		await ipcMain.call("openpi:stop_daemon");
		expect(orch.stopDaemon).toHaveBeenCalled();
		await ipcMain.call("openpi:restart_daemon");
		expect(orch.restartDaemon).toHaveBeenCalled();
	});

	it("get_snapshot reports daemon instances with sorting", async () => {
		orch.probeDaemon.mockResolvedValue({
			alive: true,
			list: {
				instances: [
					{ id: "a", status: "online", mode: "code", cwd: "/x", label: "A", sessionId: "s1", sessionFile: "f1" },
					{ id: "b", status: "stopped", mode: "work", cwd: "/y", label: "B", sessionId: "s2", sessionFile: "f2" },
					{ id: "c", status: "error", mode: "work", cwd: "/z", label: "C", sessionId: "s3" }, // no session file -> ghost
				],
			},
		});
		orch.readTasksAndRuns.mockReturnValue({ tasks: [], runs: [], instances: [] });

		const snapshot = await ipcMain.call("openpi:get_snapshot", {});
		expect(snapshot.daemonRunning).toBe(true);
		expect(snapshot.health.sessionsIndexed).toBe(true);
		expect(snapshot.instances.map((i) => i.id)).toEqual(["a"]); // default hides stopped; ghost dropped
		expect(snapshot.instanceStats.total).toBe(2);

		const withStopped = await ipcMain.call("openpi:get_snapshot", { includeStopped: true });
		expect(withStopped.instances.map((i) => i.id)).toEqual(["a", "b"]);
	});

	it("get_snapshot falls back to file instances when the daemon is down", async () => {
		orch.probeDaemon.mockResolvedValue({ alive: false, reason: "no-socket" });
		orch.readTasksAndRuns.mockReturnValue({
			tasks: [],
			runs: [],
			instances: [{ id: "f1", status: "stopped", mode: "work", cwd: "/f", label: "F", sessionFile: "ff" }],
		});

		const snapshot = await ipcMain.call("openpi:get_snapshot", {});
		expect(snapshot.daemonRunning).toBe(false);
		expect(snapshot.instances.map((i) => i.id)).toEqual(["f1"]);
		expect(orch.ensureDaemon).toHaveBeenCalledTimes(1);
	});

	it("get_snapshot aggregates task health when health is absent", async () => {
		orch.probeDaemon.mockResolvedValue({ alive: true, list: { instances: [] } });
		orch.getHealthSafe.mockResolvedValue(undefined);
		orch.readTasksAndRuns.mockReturnValue({
			tasks: [
				{ id: "t1", status: "active" },
				{ id: "t2", status: "paused" },
			],
			runs: [{ id: "r1", status: "running" }],
			instances: [],
		});

		const snapshot = await ipcMain.call("openpi:get_snapshot", {});
		expect(snapshot.health.tasksActive).toBe(1);
		expect(snapshot.health.tasksPaused).toBe(1);
		expect(snapshot.health.runsRunning).toBe(1);
	});
});
