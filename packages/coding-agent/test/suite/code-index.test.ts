import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtensionContext } from "../../src/core/extensions/types.ts";
import { createCodeIndexToolDefinition } from "../../src/core/tools/code-index.ts";

const tmpDirs: string[] = [];

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "code-index-test-"));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
	tmpDirs.length = 0;
});

async function runCodeIndex(
	path: string,
	params: { action: "outline" | "search"; query?: string; kind?: string; limit?: number },
) {
	const tool = createCodeIndexToolDefinition();
	const ctx = { cwd: path } as unknown as ExtensionContext;
	const result = await tool.execute("call-1", { ...params, path }, undefined, undefined, ctx);
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

describe("code_index", () => {
	it("outlines a TypeScript file's symbols", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "lib.ts"),
			[
				"export interface Config { retries: number }",
				"export function run(): void {}",
				"export const DEFAULT_RETRIES = 3;",
				"export class Runner {}",
				"type Result = string;",
			].join("\n"),
		);

		const text = await runCodeIndex(dir, { action: "outline" });

		expect(text).toContain("interface Config :1");
		expect(text).toContain("func run :2");
		expect(text).toContain("const DEFAULT_RETRIES :3");
		expect(text).toContain("class Runner :4");
		expect(text).toContain("type Result :5");
	});

	it("outlines Go files including methods", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "main.go"),
			[
				"package main",
				"type Server struct {}",
				"func NewServer() *Server { return nil }",
				"func (s *Server) Start() {}",
			].join("\n"),
		);

		const text = await runCodeIndex(dir, { action: "outline" });

		expect(text).toContain("struct Server");
		expect(text).toContain("func NewServer");
		expect(text).toContain("method Start");
	});

	it("outlines Python files", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "app.py"),
			["class Widget:", "    def render(self):", "        pass", "async def main():", "    pass"].join("\n"),
		);

		const text = await runCodeIndex(dir, { action: "outline" });

		expect(text).toContain("class Widget");
		expect(text).toContain("func render");
		expect(text).toContain("func main");
	});

	it("searches symbols by name across files", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "a.ts"),
			"export function connectDb(): void {}\nexport function connectCache(): void {}\n",
		);
		writeFileSync(join(dir, "b.ts"), "export function disconnect(): void {}\n");

		const text = await runCodeIndex(dir, { action: "search", query: "connectDb" });

		expect(text).toContain("connectDb");
		expect(text).not.toContain("connectCache");
		expect(text).not.toContain("disconnect");
	});

	it("skips node_modules and hidden directories", async () => {
		const dir = makeTempDir();
		mkdirSync(join(dir, "node_modules"));
		mkdirSync(join(dir, ".git"));
		writeFileSync(join(dir, "real.ts"), "export function realOne(): void {}\n");
		writeFileSync(join(dir, "node_modules", "fake.ts"), "export function fakeOne(): void {}\n");
		writeFileSync(join(dir, ".git", "ignored.ts"), "export function ignored(): void {}\n");

		const text = await runCodeIndex(dir, { action: "search", query: "One" });

		expect(text).toContain("realOne");
		expect(text).not.toContain("fakeOne");
		expect(text).not.toContain("ignored");
	});

	it("supports kind filtering", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "mix.ts"),
			"export class Alpha {}\nexport function beta(): void {}\nexport interface Gamma {}\n",
		);

		const text = await runCodeIndex(dir, { action: "outline", kind: "class" });

		expect(text).toContain("class Alpha");
		expect(text).not.toContain("func beta");
		expect(text).not.toContain("interface Gamma");
	});

	it("reports no matches for unknown queries", async () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "x.ts"), "export function only(): void {}\n");

		const text = await runCodeIndex(dir, { action: "search", query: "zzz" });
		expect(text).toContain("No symbol matching");
	});
});
