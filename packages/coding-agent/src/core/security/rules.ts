/**
 * Pure security classification rules for the builtin security gate.
 *
 * Mirrors packages/openpi-security/src/rules.ts so the builtin gate provides a
 * zero-config baseline without requiring the extension. Rule changes here
 * should be kept in sync with the extension's rule set.
 */

export type SecurityLevel = "critical" | "high" | "medium" | "low";

export interface SecurityRule {
	pattern: RegExp;
	level: SecurityLevel;
	description: string;
}

export const SECURITY_RULES: SecurityRule[] = [
	// CRITICAL - unconditionally denied
	{
		pattern: /^\s*(sudo\s+)?\s*rm\s+-rf\s+(\/|\.\.)/i,
		level: "critical",
		description: "Recursive delete of root/parent",
	},
	{ pattern: /\b(dd|mkfs|fdisk|wipe|shred)\b/i, level: "critical", description: "Disk formatting/wiping" },
	{ pattern: /\bchmod\s+777\b/i, level: "critical", description: "World-writable permissions" },
	{
		pattern: /\b(chmod|chown)\s+.*(0?[0-7]{4,}|777)\b/i,
		level: "critical",
		description: "Dangerous permission change",
	},
	{ pattern: /\b(sudo\s+)?(dd|mkfs|fdisk|wipe|shred)\b/i, level: "critical", description: "System disk destruction" },
	{
		pattern: /\b(\becho\s+.*>\s*\/dev\/|tee\s+\/dev\/)\b/i,
		level: "critical",
		description: "Writing to device files",
	},
	{ pattern: /\b(curl|wget)\s+.*\|\s*(bash|sh)\b/i, level: "critical", description: "Piping download to shell" },

	// HIGH - always requires confirmation
	{ pattern: /\brm\s+(-rf?|--recursive)\s+\S/i, level: "high", description: "Recursive file deletion" },
	{ pattern: /\bsudo\b/i, level: "high", description: "Privilege escalation" },
	{
		pattern: /\b(mv|cp)\s+.*\/(home|root|etc|usr|var)\//i,
		level: "high",
		description: "System directory modification",
	},
	{
		pattern: /\b(npm|rpm|apt|yum|pacman|brew)\s+(remove|uninstall|purge)\b/i,
		level: "high",
		description: "Package removal",
	},
	{ pattern: /\bkernel|insmod|modprobe|rmmod\b/i, level: "high", description: "Kernel module manipulation" },
	{
		pattern: /\biptables|firewall-cmd|ufw\b.*-(D|delete|remove)/i,
		level: "high",
		description: "Firewall rule removal",
	},
	{ pattern: /\b(init|telinit|shutdown|reboot|poweroff|halt)\b/i, level: "high", description: "System power control" },
	{
		pattern: /\bmount\s+.*\s+(\/home|\/root|\/etc|\/usr)\b/i,
		level: "high",
		description: "Mounting system partitions",
	},

	// MEDIUM - confirmed once then cached
	{ pattern: /\bnode\s+.*\.js\b/i, level: "medium", description: "Node.js script execution" },
	{ pattern: /\bpython\s+.*\.py\b/i, level: "medium", description: "Python script execution" },
	{ pattern: /\bbash\s+.*\.sh\b/i, level: "medium", description: "Bash script execution" },
	{ pattern: /\bsh\s+.*\.sh\b/i, level: "medium", description: "Sh script execution" },
	{ pattern: /\bcurl\s+.*-o\s+\S+/i, level: "medium", description: "File download with output" },
	{ pattern: /\bwget\s+.*-O\s+\S+/i, level: "medium", description: "File download with wget" },
	{ pattern: /\b(npm|yarn|pnpm)\s+(install|add)\b/i, level: "medium", description: "Package installation" },
	{
		pattern: /\bgit\s+(push|reset|--hard|rebase|force)\b/i,
		level: "medium",
		description: "Destructive git operation",
	},
];

export const PROTECTED_PATHS = [".env", ".git/", "node_modules/", ".ssh/", ".aws/", ".config/"];

export function isProtectedPath(path: string): boolean {
	return PROTECTED_PATHS.some((p) => path.includes(p));
}

export function classifyCommand(command: string): SecurityLevel {
	for (const rule of SECURITY_RULES) {
		if (rule.pattern.test(command)) {
			return rule.level;
		}
	}
	return "low";
}

export function classifyWriteEdit(path: string): SecurityLevel {
	if (isProtectedPath(path)) return "high";
	return "low";
}

export function describeCommand(command: string): string | undefined {
	return SECURITY_RULES.find((r) => r.pattern.test(command))?.description;
}
