import { describe, expect, it } from "vitest";
import { buildSessionMemoryIdentity, mapMilvusResults, sessionNamespace } from "../src/core/session-search-milvus.ts";

describe("session-search Milvus adapter", () => {
	it("uses stable opaque workspace namespaces and message ids", () => {
		const input = {
			workspace: "/private/workspace",
			file: "/private/sessions/session.jsonl",
			messageId: "m-1",
			timestamp: "2026-08-23T10:00:00.000Z",
			role: "user",
			text: "Remember the semantic migration.",
		};
		const first = buildSessionMemoryIdentity(input);
		const second = buildSessionMemoryIdentity(input);
		expect(first.namespace).toBe(sessionNamespace(input.workspace));
		expect(first.namespace).toMatch(/^[a-f0-9]{64}$/);
		expect(first.id).toMatch(/^[a-f0-9]{64}$/);
		expect(first.id).toBe(second.id);
		expect(first.namespace).not.toContain("workspace");
		expect(first.id).not.toContain("session");
	});

	it("maps Milvus responses only to current scanned documents", () => {
		const docs = [{ id: "known", text: "current session" }];
		expect(
			mapMilvusResults(
				[
					{ id: "missing", score: 0.99 },
					{ id: "known", score: 0.8 },
				],
				docs,
			),
		).toEqual([{ doc: docs[0], score: 0.8 }]);
	});
});
