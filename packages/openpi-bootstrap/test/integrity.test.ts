import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { enableOpenPi, verifyOpenPiIntegrity } from "../src/enable.ts";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("verifyOpenPiIntegrity", () => {
	it("passes after enable", () => {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-agent-"));
		tempDirs.push(agentDir);
		enableOpenPi({
			repoRoot,
			agentDir,
			dryRun: false,
			includeIntelligence: false,
			writeAutostart: false,
		});
		const result = verifyOpenPiIntegrity(agentDir);
		expect(result.ok).toBe(true);
		expect(result.checked).toBeGreaterThan(0);
	});
});
