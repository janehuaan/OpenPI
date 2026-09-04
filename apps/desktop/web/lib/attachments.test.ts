/**
 * attachments.ts coverage.
 *
 * The message-building step is what the model actually sees, so a malformed
 * wrapper there means the agent cannot tell prose from attached content. The
 * base64 path matters too: the naive `String.fromCharCode(...bytes)` throws on
 * anything multi-megabyte.
 */

import { describe, expect, it } from "vitest";
import { formatBytes, messageWithAttachments } from "../lib/attachments.ts";

const attachment = (name: string, text: string, truncated = false) => ({
	name,
	text,
	truncated,
	bytes: text.length,
});

describe("messageWithAttachments", () => {
	it("returns the message unchanged when nothing is attached", () => {
		expect(messageWithAttachments("just text", [])).toBe("just text");
	});

	it("wraps each attachment in a tagged block after the message", () => {
		const result = messageWithAttachments("summarize this", [attachment("notes.md", "# Notes")]);
		expect(result.startsWith("summarize this")).toBe(true);
		expect(result).toContain('<attachment name="notes.md"');
		expect(result).toContain("# Notes");
		expect(result).toContain("</attachment>");
	});

	it("includes every attachment", () => {
		const result = messageWithAttachments("compare", [
			attachment("a.md", "first"),
			attachment("b.md", "second"),
		]);
		expect(result).toContain('name="a.md"');
		expect(result).toContain('name="b.md"');
		expect(result).toContain("first");
		expect(result).toContain("second");
	});

	it("marks a truncated attachment so the model knows the text is partial", () => {
		const result = messageWithAttachments("read", [attachment("big.txt", "start…", true)]);
		expect(result).toContain('note="truncated"');
	});

	it("neutralizes a quote in the file name rather than breaking the attribute", () => {
		const result = messageWithAttachments("read", [attachment('we"ird.md', "body")]);
		expect(result).toContain(`name="we'ird.md"`);
		// Exactly one attribute-closing quote pair on that line.
		const line = result.split("\n").find((entry) => entry.includes("<attachment")) ?? "";
		expect(line.match(/"/g)?.length).toBe(2);
	});

	it("works with an empty message, which is how a file-only send arrives", () => {
		const result = messageWithAttachments("", [attachment("a.md", "content")]);
		expect(result).toContain("content");
	});

	it("keeps CJK content intact", () => {
		const result = messageWithAttachments("看这个", [attachment("中文.md", "内容在这里")]);
		expect(result).toContain("内容在这里");
		expect(result).toContain('name="中文.md"');
	});
});

describe("formatBytes", () => {
	it("uses bytes, KB and MB", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(2048)).toBe("2 KB");
		expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
	});

	it("handles zero", () => {
		expect(formatBytes(0)).toBe("0 B");
	});
});
