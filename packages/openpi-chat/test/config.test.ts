import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("openpi-chat package", () => {
	it("ships telegram and discord entrypoints", () => {
		expect(existsSync(join(root, "src/telegram.ts"))).toBe(true);
		expect(existsSync(join(root, "src/discord.ts"))).toBe(true);
		expect(existsSync(join(root, "src/cli.ts"))).toBe(true);
	});
});
