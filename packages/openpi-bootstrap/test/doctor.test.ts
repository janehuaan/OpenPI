import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor.ts";
import { enableOpenPi } from "../src/enable.ts";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("runDoctor", () => {
	it("reports healthy after enable", () => {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-doctor-"));
		tempDirs.push(agentDir);
		enableOpenPi({
			repoRoot,
			agentDir,
			dryRun: false,
			includeIntelligence: true,
			writeAutostart: false,
		});
		const result = runDoctor({ agentDir });
		expect(result.ok).toBe(true);
		expect(result.checks.some((check) => check.name === "core extensions enabled" && check.ok)).toBe(true);
	});
});
