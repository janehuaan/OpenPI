import { describe, expect, it, vi } from "vitest";
import { jsonSchemaToTypeBox, type McpCallTool, mcpToolToToolDefinition } from "../../src/core/mcp/mcp-adapter.ts";

describe("jsonSchemaToTypeBox", () => {
	it("converts a simple object schema", () => {
		const schema = jsonSchemaToTypeBox({
			type: "object",
			properties: { name: { type: "string" }, count: { type: "integer" } },
			required: ["name"],
		});
		expect(schema).toEqual({
			type: "object",
			properties: {
				name: { type: "string" },
				count: { type: "integer" },
			},
			required: ["name"],
		});
	});

	it("converts primitive types", () => {
		expect(jsonSchemaToTypeBox({ type: "string" })).toEqual({ type: "string" });
		expect(jsonSchemaToTypeBox({ type: "number" })).toEqual({ type: "number" });
		expect(jsonSchemaToTypeBox({ type: "boolean" })).toEqual({ type: "boolean" });
		expect(jsonSchemaToTypeBox({ type: "null" })).toEqual({ type: "null" });
	});

	it("converts arrays with items", () => {
		expect(jsonSchemaToTypeBox({ type: "array", items: { type: "string" } })).toEqual({
			type: "array",
			items: { type: "string" },
		});
	});

	it("converts enums to literal unions", () => {
		const schema = jsonSchemaToTypeBox({ type: "string", enum: ["a", "b"] });
		expect(schema).toEqual({
			anyOf: [
				{ type: "string", const: "a" },
				{ type: "string", const: "b" },
			],
		});
	});

	it("converts anyOf to unions", () => {
		const schema = jsonSchemaToTypeBox({ anyOf: [{ type: "string" }, { type: "number" }] });
		expect(schema).toEqual({
			anyOf: [{ type: "string" }, { type: "number" }],
		});
	});

	it("dedupes union members", () => {
		const schema = jsonSchemaToTypeBox({ oneOf: [{ type: "string" }, { type: "string" }] });
		expect(schema).toEqual({ type: "string" });
	});

	it("respects additionalProperties: false", () => {
		const schema = jsonSchemaToTypeBox({ type: "object", properties: {}, additionalProperties: false });
		expect(schema).toEqual({ type: "object", properties: {}, additionalProperties: false });
	});

	it("falls back to unknown for unsupported constructs", () => {
		expect(jsonSchemaToTypeBox({ $ref: "#/definitions/Foo" })).toEqual({});
		expect(jsonSchemaToTypeBox(undefined)).toEqual({});
		expect(jsonSchemaToTypeBox("not-a-schema")).toEqual({});
	});
});

describe("mcpToolToToolDefinition", () => {
	it("forwards execute calls to the MCP client and joins text content", async () => {
		const callTool = vi.fn(async () => ({
			content: [
				{ type: "text", text: "hello" },
				{ type: "text", text: " world" },
			],
		})) as unknown as McpCallTool;
		const definition = mcpToolToToolDefinition(
			"echo-server",
			{
				name: "echo",
				description: "Echo back input",
				inputSchema: { type: "object", properties: { text: { type: "string" } } },
			},
			callTool,
		);

		expect(definition.name).toBe("echo");
		expect(definition.description).toBe("Echo back input");
		expect(definition.promptSnippet).toContain("MCP echo-server");

		const result = await definition.execute("call-1", { text: "hi" }, undefined, undefined, undefined as never);
		expect(callTool).toHaveBeenCalledWith("echo", { text: "hi" });
		expect(result.content).toEqual([{ type: "text", text: "hello\n world" }]);
		expect(result.details).toBeUndefined();
	});

	it("marks MCP errors as tool errors", async () => {
		const callTool = vi.fn(async () => ({
			content: [{ type: "text", text: "boom" }],
			isError: true,
		})) as unknown as McpCallTool;
		const definition = mcpToolToToolDefinition("fail-server", { name: "fail", description: "Fails" }, callTool);
		const result = await definition.execute("call-1", {}, undefined, undefined, undefined as never);
		expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("failed") });
	});

	it("uses a placeholder when the MCP result has no text content", async () => {
		const callTool = vi.fn(async () => ({ content: [{ type: "image", data: "x" }] })) as unknown as McpCallTool;
		const definition = mcpToolToToolDefinition("img-server", { name: "img", description: "Returns image" }, callTool);
		const result = await definition.execute("call-1", {}, undefined, undefined, undefined as never);
		expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("empty") });
	});
});
