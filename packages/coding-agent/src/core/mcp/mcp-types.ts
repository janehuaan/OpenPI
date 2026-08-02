/**
 * MCP server configuration, read from settings.json `mcpServers`.
 *
 * Each entry is either a stdio server (command + args) or an HTTP server (url).
 * Mirrors the conventional Claude Code / MCP ecosystem config shape.
 */
export interface McpServerConfig {
	/** Stdio transport: executable to spawn. */
	command?: string;
	/** Stdio transport: arguments. */
	args?: string[];
	/** Environment overrides for the spawned process. */
	env?: Record<string, string>;
	/** Working directory for the spawned process. */
	cwd?: string;
	/** HTTP transport: streamable HTTP endpoint URL. */
	url?: string;
	/** HTTP transport: extra headers. */
	headers?: Record<string, string>;
}

/** Map of server name to config, e.g. { "filesystem": { command: "npx", args: [...] } } */
export type McpServersConfig = Record<string, McpServerConfig>;
