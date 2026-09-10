import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkSyntax, SyntaxAssertionGate } from "../src/syntax-assertion-gate.ts";

describe("SyntaxAssertionGate & Syntax Validators", () => {
	it("detects valid and invalid JSON", () => {
		expect(checkSyntax('{"name": "openpi"}', "config.json").valid).toBe(true);
		const invalid = checkSyntax('{"name": "openpi",}', "config.json");
		expect(invalid.valid).toBe(false);
		expect(invalid.error).toContain("JSON syntax error");
	});

	it("detects delimiter errors in JS/ESM", () => {
		expect(checkSyntax("export const a = 1; console.log(a);", "test.js").valid).toBe(true);
		const invalid = checkSyntax("function foo( { return 123; }", "test.js");
		expect(invalid.valid).toBe(false);
		expect(invalid.error).toContain("Unclosed delimiter");
	});

	it("detects delimiter errors in TypeScript & TSX", () => {
		expect(checkSyntax("export interface Foo { bar: string; }\nconst x: Foo = { bar: 'yes' };", "test.ts").valid).toBe(true);
		const invalidTs = checkSyntax("export interface Foo { bar: string;", "test.ts");
		expect(invalidTs.valid).toBe(false);
		expect(invalidTs.error).toContain("Unclosed delimiter '{'");

		expect(checkSyntax("export const Comp = () => <div>hello</div>;", "test.tsx").valid).toBe(true);
		const invalidTsx = checkSyntax("export const Comp = () => { return 1;", "test.tsx");
		expect(invalidTsx.valid).toBe(false);
		expect(invalidTsx.error).toContain("Unclosed delimiter '{'");
	});

	describe("File Mutation Assertions", () => {
		const tempFile = join(tmpdir(), `test-gate-${Date.now()}.json`);

		beforeEach(() => {
			writeFileSync(tempFile, JSON.stringify({ count: 1 }));
		});

		afterEach(() => {
			if (existsSync(tempFile)) unlinkSync(tempFile);
		});

		it("fails assertion when file was not changed on disk (zero mutation)", () => {
			const gate = new SyntaxAssertionGate();
			gate.capturePreTool("edit", { path: tempFile }, tmpdir());

			// Did not modify tempFile!
			const result = gate.verifyPostTool("edit", { path: tempFile }, tmpdir());
			expect(result.passed).toBe(false);
			expect(result.message).toContain("Zero mutation detected");
		});

		it("fails assertion when edited file contains fatal syntax error", () => {
			const gate = new SyntaxAssertionGate();
			gate.capturePreTool("edit", { path: tempFile }, tmpdir());

			// Corrupt JSON file
			writeFileSync(tempFile, "{\ninvalid json here\n");

			const result = gate.verifyPostTool("edit", { path: tempFile }, tmpdir());
			expect(result.passed).toBe(false);
			expect(result.message).toContain("Syntax check failed");
		});

		it("passes assertion when file was legitimately changed with valid syntax", () => {
			const gate = new SyntaxAssertionGate();
			gate.capturePreTool("edit", { path: tempFile }, tmpdir());

			writeFileSync(tempFile, JSON.stringify({ count: 2, status: "ok" }));

			const result = gate.verifyPostTool("edit", { path: tempFile }, tmpdir());
			expect(result.passed).toBe(true);
		});
	});
});
