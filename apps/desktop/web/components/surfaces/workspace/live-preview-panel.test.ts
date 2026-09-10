import { describe, expect, it } from "vitest";
import { buildSandboxHtmlDocument } from "./live-preview-panel";

describe("buildSandboxHtmlDocument", () => {
	it("wraps raw HTML snippet in complete document with Tailwind and inspector script", () => {
		const snippet = "<button class=\"px-4 py-2 bg-blue-500 text-white rounded\">Click Me</button>";
		const result = buildSandboxHtmlDocument(snippet);

		expect(result).toContain("<!DOCTYPE html>");
		expect(result).toContain("<html lang=\"zh-CN\">");
		expect(result).toContain("https://cdn.tailwindcss.com");
		expect(result).toContain(snippet);
		expect(result).toContain("OPENPI_SET_INSPECTOR");
		expect(result).toContain("OPENPI_ELEMENT_PICKED");
	});

	it("preserves already complete HTML documents without double wrapping", () => {
		const fullHtml = `<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>`;
		const result = buildSandboxHtmlDocument(fullHtml);

		expect(result).toBe(fullHtml);
	});

	it("preserves documents starting with <html> tag without double wrapping", () => {
		const htmlWithTag = `<html><body><div id="app">Test</div></body></html>`;
		const result = buildSandboxHtmlDocument(htmlWithTag);

		expect(result).toBe(htmlWithTag);
	});

	it("handles undefined or empty input cleanly", () => {
		const result = buildSandboxHtmlDocument("");

		expect(result).toContain("<!DOCTYPE html>");
		expect(result).toContain("<body");
		expect(result).toContain("</body>");
	});
});
