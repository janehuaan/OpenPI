import { describe, expect, it } from "vitest";
import { parseFileLink } from "./file-links";

describe("parseFileLink", () => {
	it("parses file:// absolute URL with line number", () => {
		const result = parseFileLink("file:///Users/huaan/openpi-next/apps/desktop/web/lib/markdown.tsx#L123");
		expect(result).not.toBeNull();
		expect(result?.filePath).toBe("/Users/huaan/openpi-next/apps/desktop/web/lib/markdown.tsx");
		expect(result?.lineStart).toBe(123);
		expect(result?.lineEnd).toBeUndefined();
	});

	it("parses file:// absolute URL with line range", () => {
		const result = parseFileLink("file:///Users/huaan/openpi-next/package.json#L10-L20");
		expect(result).not.toBeNull();
		expect(result?.filePath).toBe("/Users/huaan/openpi-next/package.json");
		expect(result?.lineStart).toBe(10);
		expect(result?.lineEnd).toBe(20);
	});

	it("parses relative file paths with known extensions", () => {
		const result = parseFileLink("src/index.ts#L42");
		expect(result).not.toBeNull();
		expect(result?.filePath).toBe("src/index.ts");
		expect(result?.lineStart).toBe(42);
	});

	it("parses dot-relative file paths without hash", () => {
		const result = parseFileLink("./components/icons.tsx");
		expect(result).not.toBeNull();
		expect(result?.filePath).toBe("./components/icons.tsx");
		expect(result?.lineStart).toBeUndefined();
	});

	it("ignores web URLs (http, https)", () => {
		expect(parseFileLink("https://github.com/janehuaan/OpenPI")).toBeNull();
		expect(parseFileLink("http://localhost:5179")).toBeNull();
	});

	it("ignores mailto and conversation URIs", () => {
		expect(parseFileLink("mailto:user@example.com")).toBeNull();
		expect(parseFileLink("conversation://64d56946-f5bb-47b1")).toBeNull();
	});

	it("decodes URL encoded paths", () => {
		const result = parseFileLink("file:///Users/huaan/my%20folder/test.ts#L5");
		expect(result).not.toBeNull();
		expect(result?.filePath).toBe("/Users/huaan/my folder/test.ts");
		expect(result?.lineStart).toBe(5);
	});
});
