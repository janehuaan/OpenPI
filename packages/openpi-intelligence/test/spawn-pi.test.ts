import { describe, expect, it } from "vitest";
import { resolvePiEntry } from "../src/spawn-pi.ts";

describe("resolvePiEntry", () => {
	it("throws a clear error when no entry exists", () => {
		const previous = process.env.PI_CLI_PATH;
		const argv1 = process.argv[1];
		process.env.PI_CLI_PATH = "/tmp/definitely-missing-pi-cli.js";
		process.argv[1] = "/tmp/also-missing.js";
		try {
			expect(() => resolvePiEntry("/tmp/nope.js")).toThrow(/Cannot resolve pi CLI/);
		} finally {
			if (previous === undefined) delete process.env.PI_CLI_PATH;
			else process.env.PI_CLI_PATH = previous;
			process.argv[1] = argv1;
		}
	});
});
