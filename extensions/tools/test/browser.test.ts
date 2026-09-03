/**
 * browser.ts coverage: the JS expression sent over CDP to locate an element.
 *
 * This string is evaluated inside the page, so a quoting slip becomes a syntax
 * error in the browser rather than a caught exception here. Injecting the
 * selector and text as one JSON payload is what makes that safe; these tests
 * pin the property that hostile input cannot break out of it.
 */

import { describe, expect, it } from "vitest";
import { resolveElementExpression } from "../src/browser.ts";

/** Best-effort syntax check: the page evaluates this, so it must at least parse. */
function parses(expression: string): boolean {
	try {
		new Function(`return ${expression}`);
		return true;
	} catch {
		return false;
	}
}

describe("resolveElementExpression", () => {
	it("produces a parseable expression", () => {
		expect(parses(resolveElementExpression("#submit", ""))).toBe(true);
	});

	it("embeds the selector and text as JSON, not interpolated source", () => {
		const expression = resolveElementExpression("#submit", "Save changes");
		expect(expression).toContain(JSON.stringify({ selector: "#submit", text: "Save changes" }));
	});

	it("survives a single quote in the text", () => {
		const expression = resolveElementExpression("", "it's fine");
		expect(parses(expression)).toBe(true);
		expect(expression).toContain("it's fine".replace("'", "'"));
	});

	it("survives a double quote in the selector", () => {
		const expression = resolveElementExpression('input[name="q"]', "");
		expect(parses(expression)).toBe(true);
	});

	it("neutralizes a payload that tries to close the expression", () => {
		const hostile = `'); window.__pwned = 1; ('`;
		const expression = resolveElementExpression("", hostile);
		expect(parses(expression)).toBe(true);
		// The payload appears only inside the JSON string literal.
		expect(expression).not.toContain("window.__pwned = 1;\n");
		expect(expression).toContain(JSON.stringify({ selector: "", text: hostile }));
	});

	it("survives newlines and backslashes", () => {
		expect(parses(resolveElementExpression("a\\b", "line1\nline2"))).toBe(true);
	});

	it("survives a script tag in the text", () => {
		expect(parses(resolveElementExpression("", "<script>alert(1)</script>"))).toBe(true);
	});

	it("handles CJK text", () => {
		const expression = resolveElementExpression("", "保存修改");
		expect(parses(expression)).toBe(true);
		expect(expression).toContain("保存修改");
	});

	it("handles both arguments empty", () => {
		expect(parses(resolveElementExpression("", ""))).toBe(true);
	});

	it("returns element geometry and a label, which is what click needs", () => {
		const expression = resolveElementExpression("#x", "");
		expect(expression).toContain("getBoundingClientRect");
		expect(expression).toContain("tag:");
		expect(expression).toContain("label:");
	});

	it("falls back from selector to text matching", () => {
		const expression = resolveElementExpression("#missing", "Click me");
		expect(expression).toContain("querySelector(p.selector)");
		expect(expression).toContain("byText(document)");
	});
});
