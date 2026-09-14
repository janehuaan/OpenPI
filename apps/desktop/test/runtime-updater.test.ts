import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractZip, RuntimeUpdateManager } from "../electron/runtime-updater.ts";

describe("RuntimeUpdateManager & Zip Extraction", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "openpi-runtime-test-"));
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	it("extracts zip archives accurately across platforms", async () => {
		const sourceDir = join(testDir, "source");
		const targetDir = join(testDir, "target");
		const zipFile = join(testDir, "test.zip");

		mkdirSync(sourceDir, { recursive: true });
		writeFileSync(join(sourceDir, "daemon.js"), "console.log('daemon');");
		writeFileSync(join(sourceDir, "manifest.json"), JSON.stringify({ version: "0.2.4" }));

		// Create test zip archive
		if (process.platform === "win32") {
			execFileSync("tar", ["-a", "-cf", zipFile, "*"], { cwd: sourceDir });
		} else {
			execFileSync("zip", ["-rq", zipFile, "."], { cwd: sourceDir });
		}

		expect(existsSync(zipFile)).toBe(true);

		// Test extractZip
		await extractZip(zipFile, targetDir);

		expect(existsSync(join(targetDir, "daemon.js"))).toBe(true);
		expect(existsSync(join(targetDir, "manifest.json"))).toBe(true);
		expect(readFileSync(join(targetDir, "daemon.js"), "utf8")).toBe("console.log('daemon');");
	});

	it("returns runtime info with built-in version metadata", () => {
		const manager = new RuntimeUpdateManager();
		const info = manager.getRuntimeInfo();

		expect(info).toBeDefined();
		expect(typeof info.currentVersion).toBe("string");
		expect(typeof info.isHotUpdated).toBe("boolean");
		expect(info.runtimePath).toBeDefined();
	});

	it("handles update check failure gracefully without crashing", async () => {
		const manager = new RuntimeUpdateManager();
		const result = await manager.checkForUpdates();

		expect(result).toBeDefined();
		expect(typeof result.hasUpdate).toBe("boolean");
		expect(result.currentVersion).toBeDefined();
	});
});
