import { describe, expect, it } from "vitest";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";

describe("builtin slash commands", () => {
	it("includes desktop-relevant commands and argument hints", () => {
		const commands = new Map(BUILTIN_SLASH_COMMANDS.map((command) => [command.name, command]));

		expect(commands.has("model")).toBe(true);
		expect(commands.get("model")?.argumentHint).toBe("<provider/model>");
		expect(commands.has("compact")).toBe(true);
		expect(commands.has("reload")).toBe(true);
		expect(commands.has("new")).toBe(true);
	});
});
