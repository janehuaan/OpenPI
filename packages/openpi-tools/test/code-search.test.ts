import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { grepSearch, rgSearch } from "../src/code-search.ts";

function mockPi(exec: ReturnType<typeof vi.fn>): ExtensionAPI {
	return { exec } as unknown as ExtensionAPI;
}

describe("rgSearch", () => {
	it("builds ripgrep args and parses match counts", async () => {
		const exec = vi.fn(async () => ({
			stdout: "src/a.ts:3:export function foo() {}\nsrc/b.ts:10:foo();\n",
			stderr: "",
			code: 0,
		}));
		const result = await rgSearch(mockPi(exec), "foo", { language: "ts", pathScope: "src", maxResults: 10 });

		expect(exec).toHaveBeenCalledWith("rg", ["-n", "-I", "--type", "ts", "-g", "src/", "-C", "0", "-m", "10", "foo"]);
		expect(result.details.total_matches).toBe(2);
		expect(result.details.tool).toBe("rg");
		expect(result.output).toContain("src/a.ts:3");
	});

	it("reports ripgrep errors in the output", async () => {
		const exec = vi.fn(async () => ({ stdout: "", stderr: "rg: error searching", code: 2 }));
		const result = await rgSearch(mockPi(exec), "foo", {});
		expect(result.output).toContain("rg: error searching");
		expect(result.details.total_matches).toBe(0);
	});
});

describe("grepSearch", () => {
	it("builds grep args with language extension mapping", async () => {
		const exec = vi.fn(async () => ({ stdout: "a.py:1:import os\n", stderr: "", code: 0 }));
		const result = await grepSearch(mockPi(exec), "import", { language: "py", maxResults: 5 });

		expect(exec).toHaveBeenCalledWith("grep", ["-rn", "-I", "--color=never", "--include", "*.py", "import", "."]);
		expect(result.details.total_matches).toBe(1);
		expect(result.details.tool).toBe("grep");
	});

	it("scopes grep to a subdirectory", async () => {
		const exec = vi.fn(async () => ({ stdout: "", stderr: "", code: 0 }));
		await grepSearch(mockPi(exec), "foo", { pathScope: "lib" });
		expect(exec).toHaveBeenCalledWith("grep", ["-rn", "-I", "--color=never", "foo", "lib"]);
	});

	it("filters binary lines and caps results", async () => {
		const exec = vi.fn(async () => ({
			stdout: Array.from({ length: 100 }, (_, i) => `f${i}.ts:${i}:match ${i}\nBinary file x matches\n`).join(""),
			stderr: "",
			code: 0,
		}));
		const result = await grepSearch(mockPi(exec), "match", { maxResults: 5 });
		expect(result.details.total_matches).toBe(5);
		expect(result.output).not.toContain("Binary");
	});
});
