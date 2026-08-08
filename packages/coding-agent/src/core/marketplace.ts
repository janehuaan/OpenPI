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
	{
		id: "pi-mcp-adapter",
		kind: "mcp",
		name: "Pi MCP Adapter",
		source: "npm:pi-mcp-adapter@2.21.0",
		description: "Pi-native MCP adapter with lazy tool discovery, compact context usage, and OAuth support.",
	},
	{
		id: "pi-mcp-native",
		kind: "mcp",
		name: "Pi MCP Native",
		source: "npm:@0xkobold/pi-mcp@0.4.0",
		description: "Native Pi MCP integration for stdio, SSE, Streamable HTTP, WebSocket, resources, and prompts.",
	},
	{
		id: "pi-mcp-extension",
		kind: "mcp",
		name: "Pi MCP Extension",
		source: "npm:pi-mcp-extension@1.5.0",
		description: "Pi extension that connects the agent to configured MCP servers.",
	},
	{
		id: "spences-pi-mcp",
		kind: "mcp",
		name: "MCP Context Manager",
		source: "npm:@spences10/pi-mcp@0.0.58",
		description: "Exposes configured MCP tools safely and manages large responses for Pi.",
	},
	{
		id: "pixu-pi-mcp",
		kind: "mcp",
		name: "Pi MCP Advisory",
		source: "npm:@pixu1980/pi-mcp@0.1.11",
		description: "Pi MCP adapter with configurable advisory thresholds for tool discovery.",
	},
	{
		id: "pi-mcp-bridge",
		kind: "mcp",
		name: "MCP Bridge",
		source: "npm:@qianhuan-lxs/pi-mcp-bridge@0.5.6",
		description: "Dynamic-context bridge that exposes MCP tools and resources through two Pi tools.",
	},
	{
		id: "pi-mcp-sidecar",
		kind: "mcp",
		name: "MCP Sidecar",
		source: "npm:pi-mcp-sidecar@0.1.0",
		description: "Independent sidecar for blocking and restoring Pi MCP Adapter servers.",
	},
	{
		id: "pi-figma-remote-auth",
		kind: "mcp",
		name: "Figma Remote MCP Auth",
		source: "npm:pi-figma-remote-auth@0.1.1",
		description: "Pi extension that authenticates and configures Figma Remote MCP through Pi MCP Adapter.",
	},

	// =========================================================================
	// Skills collections
	// =========================================================================
	{
		id: "anthropic-skills",
		kind: "skills",
		name: "Anthropic Skills",
		source: "git:github.com/anthropics/skills@f17010c9bb483898c1d9c9f42dde2b3a98889434",
		description: "Official Anthropic skill collection (docx, pdf, pptx, xlsx, artifacts).",
	},
	{
		id: "superpowers",
		kind: "skills",
		name: "Superpowers",
		source: "git:github.com/obra/superpowers@44c9b2d6e889982ac18c27d05a19fefe335194e1",
		description: "Community TDD/debugging workflow skills used across Claude Code, Cline, and Pi.",
	},
	{
		id: "red-skills-dev",
		kind: "skills",
		name: "Red Skills Dev",
		source: "npm:@reddb-io/red-skills-dev@3.12.5",
		description: "Engineering skills for triage, TDD, diagnosis, graph-aware codebase work, and autonomous delivery.",
	},
	{
		id: "barlevalon-skills",
		kind: "skills",
		name: "Agent Skills",
		source: "npm:@barlevalon/skills@2.1.0",
		description: "Maintained agent skills and upstream workflow skills packaged for Pi.",
	},
	{
		id: "pi-nx-developer",
		kind: "skills",
		name: "Nx Developer",
		source: "npm:@aliaksei-raketski/pi-nx-developer@0.3.18",
		description: "Pi-native package of Nx development skills with local documentation helpers.",
	},
	{
		id: "pi-angular-developer",
		kind: "skills",
		name: "Angular Developer",
		source: "npm:@aliaksei-raketski/pi-angular-developer@0.3.18",
		description: "Pi-native package of Angular development skills with local documentation helpers.",
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
