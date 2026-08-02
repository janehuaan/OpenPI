import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOpenPiChannel, OPENPI_IPC_CHANNELS } from "../electron/ipc-channels.mjs";
import {
	loadAgentSecretsEnv,
	monorepoRoot,
	nodeBinary,
	nodeSpawnEnv,
	openpiPackagesRoot,
	orchestratorCli,
	packagedRuntimeRoot,
	piCli,
	repoRoot,
} from "../electron/paths.mjs";

describe("desktop paths", () => {
	it("resolves repo root and orchestrator cli", () => {
		const root = repoRoot();
		expect(existsSync(root)).toBe(true);
		expect(root.includes("OpenPI.app")).toBe(false);
		expect(existsSync(orchestratorCli())).toBe(true);
		expect(existsSync(piCli())).toBe(true);
	});

	it("prefers monorepo CLIs when monorepo is present (backend-first)", () => {
		const mono = monorepoRoot();
		if (!mono) return;
		expect(piCli().includes(`${mono}/packages/coding-agent`) || piCli().includes("packages/coding-agent")).toBe(true);
		expect(
			orchestratorCli().includes(`${mono}/packages/orchestrator`) ||
				orchestratorCli().includes("packages/orchestrator"),
		).toBe(true);
		// Must not force packaged runtime when monorepo exists
		expect(piCli().includes("openpi-runtime")).toBe(false);
	});

	it("openpi packages root prefers monorepo over packaged snapshot", () => {
		const root = openpiPackagesRoot();
		expect(root).toBeTruthy();
		expect(existsSync(`${root}/packages/openpi-memory/src/index.ts`)).toBe(true);
		const mono = monorepoRoot();
		if (mono) {
			expect(root).toBe(mono);
		}
	});

	it("falls back to packaged runtime only when monorepo CLIs are absent", () => {
		const mono = monorepoRoot();
		const runtime = packagedRuntimeRoot();
		// In this repo monorepo always wins; packaged runtime may still exist for packaging
		if (mono) {
			expect(existsSync(piCli())).toBe(true);
			return;
		}
		if (!runtime) return;
		expect(piCli().includes("openpi-runtime") || piCli().includes("/runtime/")).toBe(true);
	});

	it("resolves a node binary that is not Electron.app by default in plain node", () => {
		const binary = nodeBinary();
		expect(binary.length).toBeGreaterThan(0);
		expect(binary.includes("Electron.app")).toBe(false);
		expect(nodeSpawnEnv().PATH || process.env.PATH).toBeTruthy();
	});

	it("nodeSpawnEnv can surface monorepo CLI paths", () => {
		const env = nodeSpawnEnv();
		expect(env.OPENPI_REPO_ROOT || repoRoot()).toBeTruthy();
		if (env.PI_CLI_PATH) {
			expect(existsSync(env.PI_CLI_PATH)).toBe(true);
		}
	});

	it("loadAgentSecretsEnv returns an object", () => {
		const secrets = loadAgentSecretsEnv();
		expect(secrets && typeof secrets === "object").toBe(true);
	});
});

describe("ipc allowlist", () => {
	it("includes core channels", () => {
		expect(isOpenPiChannel("get_snapshot")).toBe(true);
		expect(isOpenPiChannel("prune_stopped_instances")).toBe(true);
		expect(isOpenPiChannel("restart_daemon")).toBe(true);
		expect(isOpenPiChannel("memory_meta")).toBe(true);
		expect(isOpenPiChannel("maintain_memory")).toBe(true);
		expect(isOpenPiChannel("generate_image")).toBe(true);
		expect(isOpenPiChannel("create_video")).toBe(true);
		expect(isOpenPiChannel("start_speech_recognition")).toBe(true);
		expect(isOpenPiChannel("stop_speech_recognition")).toBe(true);
		expect(isOpenPiChannel("evil")).toBe(false);
		expect(OPENPI_IPC_CHANNELS.length).toBeGreaterThan(20);
	});
});
