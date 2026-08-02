/**
 * MCP server lifecycle manager.
 *
 * Starts one Client per configured server (stdio or streamable HTTP), discovers
 * its tools, and adapts them into RegisteredTools for the agent tool registry.
 * Exposes status for the RPC capabilities endpoint and UI.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { RegisteredTool } from "../extensions/types.ts";
import { createSyntheticSourceInfo } from "../source-info.ts";
import { type McpTool, mcpToolToToolDefinition } from "./mcp-adapter.ts";
import type { McpServerConfig, McpServersConfig } from "./mcp-types.ts";

const MCP_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

interface McpServerHandle {
	config: McpServerConfig;
	client?: Client;
	transport?: Transport;
	tools: McpTool[];
	status: "starting" | "connected" | "error";
	error?: string;
}

export interface McpServerStatus {
	name: string;
	status: "starting" | "connected" | "error";
	toolCount: number;
	error?: string;
}

export interface McpStatus {
	configured: boolean;
	loaded: boolean;
	servers: McpServerStatus[];
	tools: string[];
}

export class McpManager {
	private readonly config: McpServersConfig;
	private readonly cwd: string;
	private readonly handles = new Map<string, McpServerHandle>();
	private registeredTools: RegisteredTool[] = [];

	constructor(config: McpServersConfig, cwd: string) {
		this.config = config;
		this.cwd = cwd;
		for (const [name, serverConfig] of Object.entries(config)) {
			this.handles.set(name, { config: serverConfig, tools: [], status: "starting" });
		}
	}

	/** Start all configured MCP servers and discover their tools. Never throws. */
	async start(): Promise<void> {
		await Promise.all(Array.from(this.handles.entries()).map(([name, handle]) => this.startServer(name, handle)));
		this.rebuildRegisteredTools();
	}

	/** Close all client connections. */
	async stop(): Promise<void> {
		await Promise.all(
			Array.from(this.handles.values()).map(async (handle) => {
				try {
					await handle.client?.close();
				} catch {
					// Best effort shutdown.
				}
				handle.client = undefined;
				handle.transport = undefined;
				handle.status = "starting";
			}),
		);
		this.registeredTools = [];
	}

	/** Tools discovered from connected servers, adapted for the tool registry. */
	getRegisteredTools(): RegisteredTool[] {
		return this.registeredTools;
	}

	getStatus(): McpStatus {
		const servers: McpServerStatus[] = Array.from(this.handles.entries()).map(([name, handle]) => ({
			name,
			status: handle.status,
			toolCount: handle.tools.length,
			error: handle.error,
		}));
		const connected = servers.filter((server) => server.status === "connected");
		return {
			configured: this.handles.size > 0,
			loaded: connected.length > 0,
			servers,
			tools: connected.flatMap((server) => server.name).length > 0 ? this.allToolNames() : [],
		};
	}

	private allToolNames(): string[] {
		const names = new Set<string>();
		for (const tool of this.registeredTools) {
			names.add(tool.definition.name);
		}
		return [...names];
	}

	private async startServer(_name: string, handle: McpServerHandle): Promise<void> {
		const config = handle.config;
		const client = new Client({ name: "pi-coding-agent", version: "0.80.8" }, { capabilities: {} });
		handle.client = client;

		try {
			const transport = createTransport(config, this.cwd);
			handle.transport = transport;
			await client.connect(transport);
			const result = await client.listTools();
			handle.tools = (result.tools ?? []) as McpTool[];
			handle.status = "connected";
		} catch (error) {
			handle.status = "error";
			handle.error = error instanceof Error ? error.message : String(error);
			try {
				await client.close();
			} catch {
				// Already failed; nothing to clean up.
			}
			handle.client = undefined;
		}
	}

	private rebuildRegisteredTools(): void {
		const registered: RegisteredTool[] = [];
		const claimedNames = new Set<string>();
		for (const [serverName, handle] of this.handles) {
			if (handle.status !== "connected") continue;
			for (const tool of handle.tools) {
				if (!MCP_TOOL_NAME_PATTERN.test(tool.name)) {
					handle.error = `Invalid tool name "${tool.name}" (must match ${MCP_TOOL_NAME_PATTERN.source})`;
					continue;
				}
				if (claimedNames.has(tool.name)) {
					handle.error = `Tool name "${tool.name}" collides with another MCP server or tool`;
					continue;
				}
				claimedNames.add(tool.name);
				registered.push({
					definition: mcpToolToToolDefinition(serverName, tool, (toolName, args) =>
						this.callTool(handle, toolName, args),
					),
					sourceInfo: createSyntheticSourceInfo(`<mcp:${serverName}:${tool.name}>`, {
						source: `mcp:${serverName}`,
					}),
				});
			}
		}
		this.registeredTools = registered;
	}

	private async callTool(
		handle: McpServerHandle,
		toolName: string,
		args: Record<string, unknown>,
	): Promise<{ content: Array<{ type?: string; text?: string }>; isError?: boolean }> {
		if (!handle.client) {
			throw new Error(`MCP server for tool "${toolName}" is not connected`);
		}
		const result = await handle.client.callTool({ name: toolName, arguments: args });
		return result as { content: Array<{ type?: string; text?: string }>; isError?: boolean };
	}
}

function createTransport(config: McpServerConfig, cwd: string): Transport {
	if (config.url) {
		return new StreamableHTTPClientTransport(new URL(config.url), {
			requestInit: config.headers ? { headers: config.headers } : undefined,
		});
	}
	if (!config.command) {
		throw new Error("MCP server requires either a command or a url");
	}
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") env[key] = value;
	}
	if (config.env) {
		for (const [key, value] of Object.entries(config.env)) {
			env[key] = value;
		}
	}
	return new StdioClientTransport({
		command: config.command,
		args: config.args ?? [],
		env,
		cwd: config.cwd ?? cwd,
	});
}
