import type { SentinelCheckResult } from "./types.ts";

/**
 * Patterns that indicate destructive, irreversible, or high-risk operations.
 */
interface RiskPattern {
	id: string;
	pattern: RegExp;
	riskScore: number;
	reason: string;
}

const HIGH_RISK_PATTERNS: RiskPattern[] = [
	// Recursive force deletion of critical paths or wildcards
	{
		id: "rm_rf_root_or_wildcard",
		pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+([~/]|\*|\.\.|\$HOME)/i,
		riskScore: 0.99,
		reason: "Attempting recursive forced deletion of root, home, parent directory, or wildcard.",
	},
	{
		id: "rm_rf_general",
		pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f/i,
		riskScore: 0.88,
		reason: "Forced recursive deletion (`rm -rf`) can permanently destroy files.",
	},
	// Git state wipe / reset
	{
		id: "git_reset_hard",
		pattern: /\bgit\s+reset\s+--hard\b/i,
		riskScore: 0.95,
		reason: "`git reset --hard` will permanently discard uncommitted changes and revert working tree.",
	},
	{
		id: "git_clean_force",
		pattern: /\bgit\s+clean\s+(-[a-zA-Z]*f|--force)/i,
		riskScore: 0.92,
		reason: "`git clean -f` permanently removes untracked files without trash backup.",
	},
	{
		id: "git_branch_force_delete",
		pattern: /\bgit\s+branch\s+(-D|--delete\s+--force)/i,
		riskScore: 0.85,
		reason: "Forced branch deletion may lead to unrecoverable commits.",
	},
	{
		id: "git_push_force",
		pattern: /\bgit\s+push\s+.*(-f\b|--force\b|--force-with-lease\b)/i,
		riskScore: 0.96,
		reason: "Force pushing may overwrite remote commits for the entire team.",
	},
	// Raw disk and system formatting
	{
		id: "disk_destruction",
		pattern: /\b(mkfs|dd\s+if=.*of=\/dev|fdisk|parted)\b/i,
		riskScore: 0.99,
		reason: "Low-level block device or filesystem formatting command.",
	},
	// System shutdown / reboot / fork bombs
	{
		id: "system_shutdown",
		pattern: /\b(shutdown|reboot|poweroff|halt|init\s+0)\b/i,
		riskScore: 0.95,
		reason: "Command attempts to shut down or reboot the operating system.",
	},
	{
		id: "fork_bomb",
		pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/i,
		riskScore: 0.99,
		reason: "Denial-of-service fork bomb detected.",
	},
	// Permissions / Root escalations
	{
		id: "chmod_777_root",
		pattern: /\bchmod\s+(-R\s+)?(777|a\+rwx)\s+([~/]|\.\.|\/)/i,
		riskScore: 0.92,
		reason: "Granting global 777 permissions on system root or home directory.",
	},
	// Sensitive credentials exposure
	{
		id: "read_private_keys",
		pattern: /\b(cat|head|tail|less|more|curl|grep)\s+.*(\.ssh\/id_|id_rsa|id_ed25519|\.aws\/credentials|\.env)/i,
		riskScore: 0.87,
		reason: "Reading or dumping private keys, AWS credentials, or sensitive .env secrets.",
	},
	// Database destructive actions
	{
		id: "sql_drop_database",
		pattern: /\b(drop\s+(database|schema|table)|truncate\s+table)\b/i,
		riskScore: 0.95,
		reason: "Destructive SQL operation (DROP/TRUNCATE).",
	},
];

export class FastSentinel {
	/**
	 * Assess risk level of a terminal shell command.
	 * Executes in < 0.1ms using deterministic pattern scoring.
	 */
	static checkCommand(command: string): SentinelCheckResult {
		if (!command || typeof command !== "string") {
			return { isDangerous: false, riskScore: 0 };
		}

		const trimmed = command.trim();
		for (const rule of HIGH_RISK_PATTERNS) {
			if (rule.pattern.test(trimmed)) {
				return {
					isDangerous: rule.riskScore >= 0.85,
					riskScore: rule.riskScore,
					reason: rule.reason,
					matchedRule: rule.id,
				};
			}
		}

		return {
			isDangerous: false,
			riskScore: 0.05,
		};
	}

	/**
	 * Assess risk of a tool call before execution.
	 */
	static checkToolCall(toolName: string, input: Record<string, unknown>): SentinelCheckResult {
		if (toolName === "bash" || toolName === "powershell" || toolName === "terminal") {
			const cmd = String(input.command || input.cmd || "");
			return this.checkCommand(cmd);
		}

		if (toolName === "write" || toolName === "write_to_file") {
			const path = String(input.path || input.TargetFile || "");
			if (/(^|[/\\])(\.git|\.ssh|id_rsa|id_ed25519|\.bashrc|\.zshrc)(\/|$)/i.test(path)) {
				return {
					isDangerous: true,
					riskScore: 0.9,
					reason: `Modifying sensitive system or git metadata path: ${path}`,
					matchedRule: "sensitive_file_overwrite",
				};
			}
		}

		return { isDangerous: false, riskScore: 0 };
	}
}
