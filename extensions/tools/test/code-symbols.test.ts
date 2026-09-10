import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import registerSymbolTools from "../src/code-symbols.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("code-symbols extension", () => {
	it("registers code_symbol_search and code_symbol_references tools", () => {
		const registered: Record<string, any> = {};
		const mockPi = {
			registerTool: vi.fn((def) => {
				registered[def.name] = def;
			}),
		} as unknown as ExtensionAPI;

		registerSymbolTools(mockPi);

		expect(mockPi.registerTool).toHaveBeenCalledTimes(2);
		expect(registered["code_symbol_search"]).toBeDefined();
		expect(registered["code_symbol_references"]).toBeDefined();
	});

	it("executes code_symbol_search and returns matching symbols", async () => {
		const tempDir = mkdtempSync(join(tmpdir(), "openpi-sym-ext-test-"));
		try {
			writeFileSync(
				join(tempDir, "calculator.ts"),
				`export function calculateTax(amount: number): number {
  return amount * 0.1;
}

export class OrderProcessor {
  process() {}
}`,
			);

			const registered: Record<string, any> = {};
			const mockPi = {
				registerTool: vi.fn((def) => {
					registered[def.name] = def;
				}),
			} as unknown as ExtensionAPI;

			registerSymbolTools(mockPi);

			const searchTool = registered["code_symbol_search"];
			const ctx = { cwd: tempDir };

			const res = await searchTool.execute("call-1", { query: "calculate" }, undefined, undefined, ctx);
			expect(res.content[0].text).toContain("calculateTax");
			expect(res.details.count).toBe(1);

			const refTool = registered["code_symbol_references"];
			const refRes = await refTool.execute("call-2", { symbol: "calculateTax" }, undefined, undefined, ctx);
			expect(refRes.content[0].text).toContain("calculator.ts:1");
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
