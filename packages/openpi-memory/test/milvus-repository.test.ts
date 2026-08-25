import { describe, expect, it } from "vitest";
import { buildMilvusFilter } from "../src/milvus-repository.ts";

describe("buildMilvusFilter", () => {
	it("requires the tenancy and lifecycle filters", () => {
		expect(() => buildMilvusFilter({ namespace: "", documentKind: "memory", state: "active" })).toThrow(
			"requires namespace",
		);
	});

	it("constructs and escapes mandatory filters", () => {
		expect(buildMilvusFilter({ namespace: 'team"one', documentKind: "memory", state: "active" })).toBe(
			'namespace == "team\\"one" && document_kind == "memory" && state == "active"',
		);
	});
});
