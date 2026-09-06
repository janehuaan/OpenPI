import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rankBm25 } from "../src/rank.ts";
import { scanSessionFile } from "../src/session-search.ts";

describe("session-search", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "openpi-session-search-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("extracts messages and session title from a session jsonl file", () => {
		const sessionFile = join(tempDir, "session-1.jsonl");
		const lines = [
			JSON.stringify({ type: "session", id: "sess-1", cwd: "/test" }),
			JSON.stringify({ type: "session_info", name: "重构网络层" }),
			JSON.stringify({
				type: "message",
				id: "m1",
				timestamp: "2026-09-06T10:00:00.000Z",
				message: {
					role: "user",
					content: [{ type: "text", text: "请帮我修改 Vite 端口为 5179" }],
				},
			}),
			JSON.stringify({
				type: "message",
				id: "m2",
				timestamp: "2026-09-06T10:00:02.000Z",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "已修改 vite.config.ts 将端口更新为 5179。" }],
				},
			}),
		];
		writeFileSync(sessionFile, lines.join("\n"), "utf8");

		const { docs, title } = scanSessionFile(sessionFile);
		expect(title).toBe("重构网络层");
		expect(docs).toHaveLength(2);
		expect(docs[0].role).toBe("user");
		expect(docs[0].sessionTitle).toBe("重构网络层");
		expect(docs[0].text).toContain("Vite 端口为 5179");
		expect(docs[1].role).toBe("assistant");
		expect(docs[1].text).toContain("vite.config.ts");
	});

	it("ranks past conversation messages with CJK-aware BM25", () => {
		const sessionFile = join(tempDir, "session-2.jsonl");
		const lines = [
			JSON.stringify({ type: "session_info", name: "用户偏好配置" }),
			JSON.stringify({
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "我的沟通偏好是使用中文并且回答尽量简洁" }],
				},
			}),
			JSON.stringify({
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "如何配置 Python 虚拟环境" }],
				},
			}),
		];
		writeFileSync(sessionFile, lines.join("\n"), "utf8");

		const { docs } = scanSessionFile(sessionFile);
		const results = rankBm25(
			"沟通偏好 简洁",
			docs.map((d) => ({ id: d.id, text: d.text })),
		);

		expect(results.length).toBeGreaterThan(0);
		expect(results[0].id).toBe(docs[0].id);
		expect(results[0].score).toBeGreaterThan(0);
	});
});
