import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { enableOpenPi } from "../src/enable.ts";

const tempDirs: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

afterEach(() => {
	for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("enableOpenPi", () => {
	it("merges absolute extension paths into settings", () => {
		const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-agent-"));
		tempDirs.push(agentDir);
		fs.writeFileSync(path.join(agentDir, "settings.json"), `${JSON.stringify({ theme: "dark" }, null, "\t")}\n`);
		const result = enableOpenPi({ repoRoot, agentDir, dryRun: false, includeIntelligence: true });
		expect(result.settings.theme).toBe("dark");
		const extensions = result.settings.extensions as string[];
		expect(extensions.some((entry) => entry.endsWith("openpi-memory/src/index.ts"))).toBe(true);
		expect(extensions.some((entry) => entry.endsWith("openpi-security/src/index.ts"))).toBe(true);
		expect(fs.existsSync(result.settingsPath)).toBe(true);
	});
});
