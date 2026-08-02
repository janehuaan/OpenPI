import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadInstances } from "../../../orchestrator/src/storage.ts";
import { OrchestratorSupervisor } from "../../../orchestrator/src/supervisor.ts";

describe("orchestrator conversation lifecycle", () => {
	let directory: string;
	let projectDirectory: string;
	let sessionFile: string;
	let previousConfigDir: string | undefined;
	let previousAgentDir: string | undefined;
	let previousOrchestratorDir: string | undefined;
	let previousRadiusApiKey: string | undefined;
	const supervisors: OrchestratorSupervisor[] = [];

	beforeEach(() => {
		directory = mkdtempSync(join(tmpdir(), "pi-orchestrator-supervisor-"));
		projectDirectory = join(directory, "project");
		const configDirectory = join(directory, "config");
		const agentDirectory = join(configDirectory, "agent");
		const sessionDirectory = join(agentDirectory, "sessions", "project");
		mkdirSync(projectDirectory, { recursive: true });
		mkdirSync(sessionDirectory, { recursive: true });
		sessionFile = join(sessionDirectory, "existing-session.jsonl");
		writeFileSync(
			sessionFile,
			`${[
				{
					type: "session",
					version: 3,
					id: "existing-session",
					timestamp: "2026-07-22T00:00:00.000Z",
					cwd: projectDirectory,
				},
				{
					type: "session_info",
					id: "session-name",
					parentId: null,
					timestamp: "2026-07-22T00:00:01.000Z",
					name: "Existing conversation",
				},
			]
				.map((entry) => JSON.stringify(entry))
				.join("\n")}\n`,
		);

		previousConfigDir = process.env.PI_CONFIG_DIR;
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		previousOrchestratorDir = process.env.PI_ORCHESTRATOR_DIR;
		previousRadiusApiKey = process.env.RADIUS_API_KEY;
		process.env.PI_CONFIG_DIR = configDirectory;
		process.env.PI_CODING_AGENT_DIR = agentDirectory;
		process.env.PI_ORCHESTRATOR_DIR = join(directory, "orchestrator");
		delete process.env.RADIUS_API_KEY;
	});

	afterEach(async () => {
		for (const supervisor of supervisors.splice(0)) {
			await supervisor.shutdown();
		}
		if (previousConfigDir === undefined) delete process.env.PI_CONFIG_DIR;
		else process.env.PI_CONFIG_DIR = previousConfigDir;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		if (previousOrchestratorDir === undefined) delete process.env.PI_ORCHESTRATOR_DIR;
		else process.env.PI_ORCHESTRATOR_DIR = previousOrchestratorDir;
		if (previousRadiusApiKey === undefined) delete process.env.RADIUS_API_KEY;
		else process.env.RADIUS_API_KEY = previousRadiusApiKey;
		rmSync(directory, { recursive: true, force: true });
	});

	it("discovers, resumes, renames, restores, and deletes a historical session", async () => {
		const supervisor = new OrchestratorSupervisor();
		supervisors.push(supervisor);
		await supervisor.recoverAfterRestart();
		await supervisor.waitForSessionRefresh();

		const [discovered] = supervisor.listInstances();
		expect(discovered).toMatchObject({
			status: "stopped",
			label: "Existing conversation",
			sessionId: "existing-session",
			sessionFile,
			autoResume: false,
		});

		const response = await supervisor.handleRpc(discovered.id, { type: "get_state" });
		expect(response).toMatchObject({ command: "get_state", success: true });
		expect(supervisor.getInstance(discovered.id)).toMatchObject({ status: "online", autoResume: true });

		await supervisor.renameInstance(discovered.id, "Renamed conversation");
		expect(supervisor.getInstance(discovered.id)?.label).toBe("Renamed conversation");

		await supervisor.shutdown();
		supervisors.splice(supervisors.indexOf(supervisor), 1);
		expect(loadInstances()[0]).toMatchObject({ status: "stopped", autoResume: true });

		const recoveredSupervisor = new OrchestratorSupervisor();
		supervisors.push(recoveredSupervisor);
		await recoveredSupervisor.recoverAfterRestart();
		expect(recoveredSupervisor.getInstance(discovered.id)).toMatchObject({
			status: "online",
			label: "Renamed conversation",
		});

		expect(await recoveredSupervisor.deleteInstance(discovered.id)).toBe(true);
		expect(existsSync(sessionFile)).toBe(false);
		expect(loadInstances()).toEqual([]);
	}, 30_000);
});
