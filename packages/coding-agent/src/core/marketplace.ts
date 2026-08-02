/**
 * Built-in marketplace of packages (MCP servers, skills, repositories).
 *
 * The desktop app keeps a richer display copy in
 * packages/openpi-desktop/web/marketplace.ts; keep entries in sync.
 */

export type MarketplaceKind = "skills" | "mcp" | "repositories";

export interface MarketplacePackage {
	id: string;
	kind: MarketplaceKind;
	name: string;
	source: string;
	description: string;
}

export const MARKETPLACE_PACKAGES: MarketplacePackage[] = [
	// =========================================================================
	// Official MCP servers (modelcontextprotocol/servers)
	// =========================================================================
	{
		id: "mcp-filesystem",
		kind: "mcp",
		name: "MCP Filesystem",
		source: "npm:@modelcontextprotocol/server-filesystem@2026.7.10",
		description: "Official filesystem access server (read/write, search, directory listings).",
	},
	{
		id: "mcp-memory",
		kind: "mcp",
		name: "MCP Memory",
		source: "npm:@modelcontextprotocol/server-memory@2026.7.4",
		description: "Official knowledge-graph memory server (entities, relations, observations).",
	},
	{
		id: "mcp-sequential-thinking",
		kind: "mcp",
		name: "MCP Sequential Thinking",
		source: "npm:@modelcontextprotocol/server-sequential-thinking@2026.7.4",
		description: "Official structured thinking tool for multi-step problem solving.",
	},
	{
		id: "mcp-git",
		kind: "mcp",
		name: "MCP Git",
		source: "git:github.com/modelcontextprotocol/servers",
		description: "Official git operations server (status, diffs, commits).",
	},

	// =========================================================================
	// Skills collections
	// =========================================================================
	{
		id: "anthropic-skills",
		kind: "skills",
		name: "Anthropic Skills",
		source: "git:github.com/anthropics/skills",
		description: "Official Anthropic skill collection (docx, pdf, pptx, xlsx, artifacts).",
	},
	{
		id: "superpowers",
		kind: "skills",
		name: "Superpowers",
		source: "git:github.com/obra/superpowers",
		description: "Community TDD/debugging workflow skills used across Claude Code, Cline, and Pi.",
	},
	{
		id: "bigpowers",
		kind: "skills",
		name: "BigPowers",
		source: "npm:bigpowers@2.77.2",
		description: "73 engineering skills covering specifications, testing, debugging, review, and delivery.",
	},
	{
		id: "superpowers-zh",
		kind: "skills",
		name: "Superpowers ZH",
		source: "npm:superpowers-zh@1.7.1",
		description: "Chinese-localized Superpowers skills with TDD, debugging, and code-review workflows.",
	},

	// =========================================================================
	// Pi ecosystem packages
	// =========================================================================
	{
		id: "pi-mcp-adapter",
		kind: "mcp",
		name: "Pi MCP Adapter",
		source: "npm:pi-mcp-adapter@2.11.0",
		description: "Adapter package exposing MCP servers as Pi tools (legacy bridge; prefer native mcpServers).",
	},
	{
		id: "pi-sandbox",
		kind: "repositories",
		name: "Pi Sandbox",
		source: "git:github.com/carderne/pi-sandbox",
		description: "Sandboxed command execution for Pi.",
	},
	{
		id: "pi-agent-teams",
		kind: "repositories",
		name: "Agent Teams",
		source: "git:github.com/tmustier/pi-agent-teams",
		description: "Multi-agent team orchestration for Pi.",
	},
];

export function findMarketplacePackage(id: string): MarketplacePackage | undefined {
	return MARKETPLACE_PACKAGES.find((pkg) => pkg.id === id);
}
