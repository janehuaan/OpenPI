import { describe, expect, it } from "vitest";
import {
	extractCodeOutline,
	extractCsvOutline,
	extractJsonOutline,
	extractMarkdownHeadings,
	formatFileSummary,
	generateFileSummary,
} from "../src/auto-summary.ts";

describe("extractCodeOutline", () => {
	it("extracts classes, interfaces, types, and functions from TypeScript", () => {
		const lines = [
			'import { useState } from "react";',
			"export interface UserConfig {",
			"  id: string;",
			"  timeout: number;",
			"}",
			'export type Status = "idle" | "running" | "done";',
			"export class DatabaseService extends BaseService {",
			"  constructor() { super(); }",
			"  public async connect(): Promise<void> {}",
			"  public disconnect(): void {}",
			"}",
			"export async function fetchRecord(id: string): Promise<UserConfig> {",
			"  return {} as any;",
			"}",
		];

		const outline = extractCodeOutline(lines);
		expect(outline.interfaces).toContain("UserConfig");
		expect(outline.types).toContain("Status");
		expect(outline.classes.length).toBe(1);
		expect(outline.classes[0]?.name).toBe("DatabaseService");
		expect(outline.classes[0]?.extends).toBe("BaseService");
		expect(outline.classes[0]?.methods).toContain("connect");
		expect(outline.classes[0]?.methods).toContain("disconnect");
		expect(outline.functions.length).toBe(1);
		expect(outline.functions[0]).toContain("fetchRecord");
	});

	it("extracts Python classes and functions", () => {
		const lines = [
			"import os",
			"class WorkerThread(threading.Thread):",
			"    def run(self):",
			"        pass",
			"def process_batch(items):",
			"    return len(items)",
		];

		const outline = extractCodeOutline(lines);
		expect(outline.classes.length).toBe(1);
		expect(outline.classes[0]?.name).toBe("WorkerThread");
		expect(outline.classes[0]?.extends).toBe("threading.Thread");
		expect(outline.functions.length).toBe(1);
		expect(outline.functions[0]).toContain("process_batch");
	});
});

describe("extractJsonOutline", () => {
	it("summarizes object JSON with key types", () => {
		const json = JSON.stringify({
			version: "1.0",
			count: 42,
			active: true,
			meta: { author: "alice" },
			items: [1, 2, 3, 4],
		});

		const outline = extractJsonOutline(json);
		expect(outline.rootType).toBe("object");
		expect(outline.totalKeys).toBe(5);
		expect(outline.keySummary?.some((k) => k.includes('"items": Array[4]'))).toBe(true);
		expect(outline.keySummary?.some((k) => k.includes('"meta": Object (1 keys)'))).toBe(true);
	});

	it("summarizes array JSON with length and sample keys", () => {
		const json = JSON.stringify([
			{ id: "1", name: "Alpha", active: true },
			{ id: "2", name: "Beta", active: false },
		]);

		const outline = extractJsonOutline(json);
		expect(outline.rootType).toBe("array");
		expect(outline.length).toBe(2);
		expect(outline.sampleKeys).toEqual(["id", "name", "active"]);
	});

	it("handles malformed JSON gracefully", () => {
		const outline = extractJsonOutline("{ not valid json");
		expect(outline.rootType).toBe("other");
	});
});

describe("extractCsvOutline", () => {
	it("extracts comma-separated headers and row count", () => {
		const lines = ["id,name,email,role", "1,alice,alice@example.com,admin", "2,bob,bob@example.com,user"];
		const outline = extractCsvOutline(lines);
		expect(outline).toBeDefined();
		expect(outline?.columns).toEqual(["id", "name", "email", "role"]);
		expect(outline?.totalRows).toBe(2);
		expect(outline?.delimiter).toBe("comma");
	});

	it("extracts tab-separated headers", () => {
		const lines = ["colA\tcolB\tcolC", "1\t2\t3"];
		const outline = extractCsvOutline(lines);
		expect(outline?.delimiter).toBe("tab");
		expect(outline?.columns).toEqual(["colA", "colB", "colC"]);
	});
});

describe("extractMarkdownHeadings", () => {
	it("extracts outline hierarchy", () => {
		const lines = [
			"# Title",
			"Introductory text...",
			"## Section 1",
			"Body 1...",
			"### Subsection 1.1",
			"Body 1.1...",
			"## Section 2",
		];
		const headings = extractMarkdownHeadings(lines);
		expect(headings.length).toBe(4);
		expect(headings[0]).toEqual({ level: 1, title: "Title" });
		expect(headings[1]).toEqual({ level: 2, title: "Section 1" });
		expect(headings[2]).toEqual({ level: 3, title: "Subsection 1.1" });
		expect(headings[3]).toEqual({ level: 2, title: "Section 2" });
	});
});

describe("generateFileSummary & formatFileSummary", () => {
	it("formats code summary with outline and preview sample", () => {
		const lines = [
			"// Header comment",
			"export interface Config { timeout: number }",
			"export class App { run() {} }",
			...Array.from({ length: 50 }, (_, i) => `const x_${i} = ${i};`),
			"export default App;",
		];
		const summary = generateFileSummary("src/app.ts", lines);
		expect(summary.kind).toBe("code");
		expect(summary.totalLines).toBe(lines.length);

		const formatted = formatFileSummary(summary);
		expect(formatted).toContain("Auto-Summary Mode");
		expect(formatted).toContain("class App");
		expect(formatted).toContain("interface Config");
		expect(formatted).toContain("First 10 lines preview:");
		expect(formatted).toContain("Last 5 lines preview:");
		expect(formatted).toContain("Use offset=<N> limit=<M>");
	});

	it("formats json summary with structure details", () => {
		const jsonLines = [
			"{",
			'  "name": "large-db",',
			'  "records": [',
			...Array.from({ length: 100 }, (_, i) => `    { "id": ${i} },`),
			"  ]",
			"}",
		];
		const summary = generateFileSummary("db.json", jsonLines);
		expect(summary.kind).toBe("json");

		const formatted = formatFileSummary(summary);
		expect(formatted).toContain("JSON Structure:");
		expect(formatted).toContain('"name": string');
		expect(formatted).toContain('"records": Array[100]');
	});
});
