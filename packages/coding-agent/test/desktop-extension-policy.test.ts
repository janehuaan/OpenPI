import { describe, expect, it } from "vitest";
import { disableDesktopPiShazamStartupHooks } from "../src/core/desktop-extension-policy.ts";
import { createExtensionRuntime } from "../src/core/extensions/loader.ts";
import type { Extension, LoadExtensionsResult } from "../src/core/extensions/types.ts";
import { createSyntheticSourceInfo } from "../src/core/source-info.ts";

function createExtension(path: string, withStartupHook = true): Extension {
	const handlers = new Map<string, ((...args: unknown[]) => Promise<unknown>)[]>();
	if (withStartupHook) {
		handlers.set("before_agent_start", [async () => undefined]);
	}
	return {
		path,
		resolvedPath: path,
		sourceInfo: createSyntheticSourceInfo(path, { source: "test" }),
		handlers,
		tools: new Map(),
		messageRenderers: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
}

function createResult(extensions: Extension[]): LoadExtensionsResult {
	return {
		extensions,
		errors: [],
		runtime: createExtensionRuntime(),
	};
}

describe("desktop extension policy", () => {
	it("removes pi-shazam startup hooks while preserving its tools and commands", () => {
		const shazam = createExtension("/Users/test/.pi/agent/npm/node_modules/pi-shazam/dist/index.js");
		const tools = shazam.tools;
		const commands = shazam.commands;
		const result = createResult([shazam]);

		const filtered = disableDesktopPiShazamStartupHooks(result);

		expect(filtered.extensions[0]?.handlers.has("before_agent_start")).toBe(false);
		expect(filtered.extensions[0]?.tools).toBe(tools);
		expect(filtered.extensions[0]?.commands).toBe(commands);
		expect(result.extensions[0]?.handlers.has("before_agent_start")).toBe(true);
	});

	it("leaves other extensions unchanged", () => {
		const other = createExtension("/Users/test/.pi/agent/extensions/memory.ts");
		const result = createResult([other]);

		expect(disableDesktopPiShazamStartupHooks(result)).toBe(result);
		expect(other.handlers.has("before_agent_start")).toBe(true);
	});
});
