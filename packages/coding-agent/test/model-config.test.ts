import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ModelConfig } from "../src/core/model-config.ts";

const tempDirs: string[] = [];

function writeModelsJson(content: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-model-config-"));
	tempDirs.push(dir);
	const path = join(dir, "models.json");
	writeFileSync(path, `${JSON.stringify(content)}\n`, "utf8");
	return path;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	}
});

describe("ModelConfig enabled filtering", () => {
	it("excludes providers with enabled: false", async () => {
		const path = writeModelsJson({
			providers: {
				enabledProvider: { baseUrl: "https://a.test/v1", apiKey: "sk-a" },
				disabledProvider: { baseUrl: "https://b.test/v1", apiKey: "sk-b", enabled: false },
			},
		});
		const config = await ModelConfig.load(path);
		expect([...config.getProviderIds()].sort()).toEqual(["enabledProvider"]);
		expect(config.getProvider("disabledProvider")).toBeUndefined();
	});

	it("keeps providers without an enabled flag", async () => {
		const path = writeModelsJson({
			providers: {
				implicit: { baseUrl: "https://a.test/v1", apiKey: "sk-a" },
				explicit: { baseUrl: "https://b.test/v1", apiKey: "sk-b", enabled: true },
			},
		});
		const config = await ModelConfig.load(path);
		expect([...config.getProviderIds()].sort()).toEqual(["explicit", "implicit"]);
	});

	it("accepts the enabled field in the schema", async () => {
		const path = writeModelsJson({
			providers: {
				ok: { baseUrl: "https://a.test/v1", apiKey: "sk-a", enabled: false, name: "OK" },
			},
		});
		const config = await ModelConfig.load(path);
		expect(config.getError()).toBeUndefined();
		expect([...config.getProviderIds()]).toEqual([]);
	});
});
