/**
 * Adapt MCP tools to the coding-agent tool registry.
 *
 * - Converts MCP JSON Schema input schemas to TypeBox schemas (common subset;
 *   unsupported constructs fall back to Type.Unknown()).
 * - Builds a ToolDefinition whose execute() forwards to the MCP client.
 */
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TextContent } from "@earendil-works/pi-ai";
import { type TSchema, Type } from "typebox";
import type { ToolDefinition } from "../extensions/types.ts";

/** Minimal view of an MCP tool as returned by client.listTools(). */
export interface McpTool {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

export type McpCallTool = (
	name: string,
	args: Record<string, unknown>,
) => Promise<{ content: Array<{ type?: string; text?: string }>; isError?: boolean }>;

/**
 * Convert a JSON Schema (MCP inputSchema) to a TypeBox schema.
 *
 * Handles the common subset: object/properties/required, string/number/integer/
 * boolean/null, array/items, enum, const, anyOf/oneOf, and additionalProperties.
 * Anything else (refs, allOf, formats, patternProperties, ...) falls back to
 * Type.Unknown() so the tool stays usable without strict validation.
 */
export function jsonSchemaToTypeBox(schema: unknown): TSchema {
	if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
		return Type.Unknown();
	}
	const s = schema as Record<string, unknown>;

	if (s.enum !== undefined && Array.isArray(s.enum)) {
		const members = s.enum.map((value) => jsonSchemaValueToType(value));
		return members.length > 0 ? Type.Union(members) : Type.Unknown();
	}
	if (s.const !== undefined) {
		return jsonSchemaValueToType(s.const);
	}

	const anyOf = s.anyOf ?? s.oneOf;
	if (Array.isArray(anyOf)) {
		const members = anyOf
			.filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
			.map((m) => jsonSchemaToTypeBox(m));
		const distinct = dedupeSchemas(members);
		if (distinct.length === 1) return distinct[0];
		if (distinct.length > 0) return Type.Union(distinct);
	}

	const type = s.type;
	if (type === "object" || (type === undefined && typeof s.properties === "object" && s.properties !== null)) {
		const properties = (s.properties ?? {}) as Record<string, unknown>;
		const required = Array.isArray(s.required) ? (s.required as string[]) : [];
		const objectProps = Object.fromEntries(
			Object.entries(properties)
				.filter(([, value]) => typeof value === "object" && value !== null)
				.map(([key, value]) => [key, jsonSchemaToTypeBox(value)] as const),
		);
		const options: Record<string, unknown> = {};
		if (required.length > 0) {
			options.required = required.filter((key) => key in objectProps);
		}
		if (s.additionalProperties === false) {
			options.additionalProperties = false;
		}
		return Type.Object(objectProps, options);
	}
	if (type === "array" || Array.isArray(type)) {
		const items = Array.isArray(s.items) ? s.items[0] : s.items;
		return Type.Array(jsonSchemaToTypeBox(items));
	}
	if (type === "string") return Type.String();
	if (type === "number") return Type.Number();
	if (type === "integer") return Type.Integer();
	if (type === "boolean") return Type.Boolean();
	if (type === "null") return Type.Null();
	if (Array.isArray(type)) {
		const members = type.map((t) => jsonSchemaToTypeBox({ type: t }));
		return members.length > 0 ? Type.Union(members) : Type.Unknown();
	}
	return Type.Unknown();
}

function jsonSchemaValueToType(value: unknown): TSchema {
	if (typeof value === "string") return Type.Literal(value);
	if (typeof value === "number") return Type.Literal(value);
	if (typeof value === "boolean") return Type.Literal(value);
	if (value === null) return Type.Null();
	return Type.Unknown();
}

function dedupeSchemas(schemas: TSchema[]): TSchema[] {
	const seen = new Set<string>();
	const result: TSchema[] = [];
	for (const schema of schemas) {
		const key = JSON.stringify(schema);
		if (!seen.has(key)) {
			seen.add(key);
			result.push(schema);
		}
	}
	return result;
}

/**
 * Build a ToolDefinition for an MCP tool.
 *
 * The tool name is used as-is; callers must ensure it is a valid MCP tool name
 * ([a-zA-Z0-9_-]+) and handle collisions with existing tools.
 */
export function mcpToolToToolDefinition(serverName: string, tool: McpTool, callTool: McpCallTool): ToolDefinition {
	return {
		name: tool.name,
		label: `${serverName}: ${tool.name}`,
		description: tool.description ?? `MCP tool ${tool.name} from server ${serverName}`,
		promptSnippet: `${tool.name} (MCP ${serverName}) - ${tool.description ?? "no description"}`,
		parameters: jsonSchemaToTypeBox(tool.inputSchema),
		execute: async (_toolCallId, params) => {
			const result = await callTool(tool.name, params as Record<string, unknown>);
			const text = result.content
				.filter((block) => typeof block.text === "string")
				.map((block) => block.text)
				.join("\n");
			const content: TextContent[] = [{ type: "text", text: text || "(empty MCP result)" }];
			const toolResult: AgentToolResult<unknown> = {
				content,
				details: undefined,
			};
			if (result.isError) {
				return {
					...toolResult,
					content: [
						{
							type: "text",
							text: `MCP tool ${tool.name} failed:\n${text || "no error detail"}`,
						},
					],
					details: { mcpError: true },
				} as AgentToolResult<unknown>;
			}
			return toolResult;
		},
	};
}
