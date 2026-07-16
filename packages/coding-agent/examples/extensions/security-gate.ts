/**
 * Security Gate Extension
 *
 * Comprehensive permission and approval system for dangerous operations.
 * Integrates and enhances the functionality of permission-gate, protected-paths,
 * and dirty-repo-guard into a single unified extension.
 *
 * Security levels:
 * - CRITICAL: Unconditionally denied (rm -rf /, sudo, format disks)
 * - HIGH: Always requires confirmation (rm -rf in project, .env/.git modification, large writes)
 * - MEDIUM: Confirmed once then cached for the session (editing unknown files, running scripts)
 * - LOW: Passes silently (read, grep, find, ls, safe bash)
 *
 * Modes (via --security-gate-mode flag):
 * - strict: Block everything at HIGH level without asking
 * - confirm: Ask for confirmation at HIGH/MEDIUM levels
 * - permissive: Only block CRITICAL operations
 *
 * Usage:
 *   pi --extension examples/extensions/security-gate.ts
 *   pi --extension examples/extensions/security-gate.ts --security-gate-mode strict
 */

import type { ExtensionAPI, ExtensionContext, SessionMessageEntry } from "@earendil-works/pi-coding-agent";

// ============================================================================
// Security Levels
// ============================================================================

type SecurityLevel = "critical" | "high" | "medium" | "low";

interface SecurityRule {
	pattern: RegExp;
	level: SecurityLevel;
	description: string;
}

interface AuditLog {
	timestamp: number;
	action: string;
	tool: string;
	target: string;
	decision: "allowed" | "blocked" | "confirmed";
	reason?: string;
}

interface SecurityState {
	auditLog: AuditLog[];
	confirmedHighPaths: string[];
	confirmedMediumOps: string[];
}

// ============================================================================
// Rules Definition
// ============================================================================

const SECURITY_RULES: SecurityRule[] = [
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

// ============================================================================
// Protected Paths
// ============================================================================

const PROTECTED_PATHS = [".env", ".git/", "node_modules/", ".ssh/", ".aws/", ".config/"];

function isProtectedPath(path: string): boolean {
	return PROTECTED_PATHS.some((p) => path.includes(p));
}

// ============================================================================
// Git Dirty Check
// ============================================================================

async function isRepoDirty(pi: ExtensionAPI): Promise<boolean> {
	try {
		const { stdout, code } = await pi.exec("git", ["status", "--porcelain"]);
		if (code !== 0) return false; // Not a git repo
		return stdout.trim().length > 0;
	} catch {
		return false;
	}
}

// ============================================================================
// Helpers
// ============================================================================

function classifyCommand(command: string): SecurityLevel {
	for (const rule of SECURITY_RULES) {
		if (rule.pattern.test(command)) {
			return rule.level;
		}
	}
	return "low";
}

function classifyWriteEdit(path: string): SecurityLevel {
	if (isProtectedPath(path)) return "high";
	return "low";
}

function logAudit(state: SecurityState, tool: string, target: string, decision: AuditLog["decision"], reason?: string) {
	state.auditLog.push({
		timestamp: Date.now(),
		action: tool,
		tool,
		target,
		decision,
		reason,
	});
	// Keep last 100 entries
	if (state.auditLog.length > 100) {
		state.auditLog = state.auditLog.slice(-100);
	}
}

function reconstructState(ctx: ExtensionContext): SecurityState {
	const state: SecurityState = { auditLog: [], confirmedHighPaths: [], confirmedMediumOps: [] };

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (msg.role !== "toolResult" || msg.toolName !== "security_gate") continue;

		const details = msg.details as { state?: SecurityState } | undefined;
		if (details?.state) {
			return details.state;
		}
	}

	return state;
}

function persistState(pi: ExtensionAPI, state: SecurityState) {
	pi.appendEntry("security-gate-state", {
		auditLog: state.auditLog,
		confirmedHighPaths: state.confirmedHighPaths,
		confirmedMediumOps: state.confirmedMediumOps,
	});
}

// ============================================================================
// Extension
// ============================================================================

export default function (pi: ExtensionAPI) {
	let state: SecurityState = { auditLog: [], confirmedHighPaths: [], confirmedMediumOps: [] };
	let mode: "strict" | "confirm" | "permissive" = "confirm";

	pi.registerFlag("security-gate-mode", {
		description: "Security gate enforcement mode: strict, confirm, or permissive",
		type: "string",
		default: "confirm",
	});

	pi.on("session_start", async (_event, ctx) => {
		state = reconstructState(ctx);
		const flagVal = pi.getFlag("security-gate-mode");
		if (flagVal === "strict" || flagVal === "permissive") {
			mode = flagVal as "strict" | "permissive";
		} else {
			mode = "confirm";
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		state = reconstructState(ctx);
	});

	// --- Bash tool interception ---
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined;

		const command = event.input.command as string;
		const level = classifyCommand(command);

		// CRITICAL: always block
		if (level === "critical") {
			logAudit(state, "bash", command, "blocked");
			persistState(pi, state);
			return {
				block: true,
				reason: `CRITICAL: ${SECURITY_RULES.find((r) => r.pattern.test(command))?.description ?? "Dangerous operation"}`,
			};
		}

		// LOW: pass silently
		if (level === "low") return undefined;

		// Check if repo is dirty for medium+ operations
		const dirty = await isRepoDirty(pi);

		if (level === "high") {
			if (mode === "strict") {
				logAudit(state, "bash", command, "blocked", "Strict mode");
				persistState(pi, state);
				return {
					block: true,
					reason: `HIGH: Blocked by security gate (strict mode). ${SECURITY_RULES.find((r) => r.pattern.test(command))?.description ?? "Potentially dangerous operation"}`,
				};
			}

			// Check if already confirmed this session
			const hash = command.slice(0, 50);
			if (state.confirmedHighPaths.includes(hash)) {
				logAudit(state, "bash", command, "allowed", "Previously confirmed");
				persistState(pi, state);
				return undefined;
			}

			if (!ctx.hasUI) {
				logAudit(state, "bash", command, "blocked", "No UI for confirmation");
				persistState(pi, state);
				return { block: true, reason: "HIGH: No UI available for confirmation" };
			}

			const ruleDesc =
				SECURITY_RULES.find((r) => r.pattern.test(command))?.description ?? "Potentially dangerous operation";
			const choice = await ctx.ui.select(
				`⚠️ HIGH risk operation:\n\n  ${command}\n\nTriggered: ${ruleDesc}${dirty ? "\nNote: Uncommitted changes in repo." : ""}\n\nAllow?`,
				["Yes", "No"],
			);

			if (choice === "Yes") {
				state.confirmedHighPaths.push(hash);
				logAudit(state, "bash", command, "confirmed", ruleDesc);
				persistState(pi, state);
				return undefined;
			}

			logAudit(state, "bash", command, "blocked", "User denied");
			persistState(pi, state);
			return { block: true, reason: `Blocked: ${ruleDesc}` };
		}

		// MEDIUM
		if (level === "medium") {
			if (mode === "strict") {
				logAudit(state, "bash", command, "blocked", "Strict mode");
				persistState(pi, state);
				return { block: true, reason: "MEDIUM: Blocked by security gate (strict mode)" };
			}

			const hash = command.slice(0, 50);
			if (state.confirmedMediumOps.includes(hash)) {
				logAudit(state, "bash", command, "allowed", "Previously confirmed");
				persistState(pi, state);
				return undefined;
			}

			if (!ctx.hasUI) {
				logAudit(state, "bash", command, "blocked", "No UI for confirmation");
				persistState(pi, state);
				return { block: true, reason: "MEDIUM: No UI available for confirmation" };
			}

			const ruleDesc =
				SECURITY_RULES.find((r) => r.pattern.test(command))?.description ?? "Operation requiring attention";
			const choice = await ctx.ui.select(
				`⚠️ MEDIUM risk operation:\n\n  ${command}\n\nTriggered: ${ruleDesc}${dirty ? "\nNote: Uncommitted changes in repo." : ""}\n\nAllow once?`,
				["Yes, allow", "No"],
			);

			if (choice === "Yes, allow") {
				state.confirmedMediumOps.push(hash);
				logAudit(state, "bash", command, "confirmed", ruleDesc);
				persistState(pi, state);
				return undefined;
			}

			logAudit(state, "bash", command, "blocked", "User denied");
			persistState(pi, state);
			return { block: true, reason: `Blocked: ${ruleDesc}` };
		}

		return undefined;
	});

	// --- Write/Edit tool interception ---
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

		const path = event.input.path as string;
		const level = classifyWriteEdit(path);

		if (level === "critical") {
			logAudit(state, event.toolName, path, "blocked");
			persistState(pi, state);
			return { block: true, reason: "CRITICAL: Writing to protected system path" };
		}

		if (level === "high") {
			if (mode === "strict") {
				logAudit(state, event.toolName, path, "blocked", "Strict mode");
				persistState(pi, state);
				return {
					block: true,
					reason: `HIGH: Blocked by security gate (strict mode). Path "${path}" is in a protected directory.`,
				};
			}

			if (!ctx.hasUI) {
				logAudit(state, event.toolName, path, "blocked", "No UI");
				persistState(pi, state);
				return { block: true, reason: "HIGH: No UI available for confirmation" };
			}

			const choice = await ctx.ui.select(`⚠️ Modifying protected path:\n\n  ${path}\n\nAllow?`, ["Yes", "No"]);

			if (choice === "Yes") {
				logAudit(state, event.toolName, path, "confirmed");
				persistState(pi, state);
				return undefined;
			}

			logAudit(state, event.toolName, path, "blocked", "User denied");
			persistState(pi, state);
			return { block: true, reason: `Blocked: Writing to protected path "${path}"` };
		}

		return undefined;
	});

	// --- Session switch/fork dirty check ---
	pi.on("session_before_switch", async (_event, ctx) => {
		const dirty = await isRepoDirty(pi);
		if (!dirty) return undefined;

		if (!ctx.hasUI) return undefined;

		const entries = ctx.sessionManager.getEntries();
		const hasUnsavedWork = entries.some(
			(e): e is SessionMessageEntry => e.type === "message" && e.message.role === "user",
		);

		if (hasUnsavedWork) {
			const choice = await ctx.ui.select(`You have uncommitted git changes and unsaved messages. Switch anyway?`, [
				"Yes, proceed",
				"No, stay",
			]);
			if (choice !== "Yes, proceed") {
				return { cancel: true };
			}
		} else {
			const choice = await ctx.ui.select(`You have uncommitted git changes. Switch anyway?`, [
				"Yes, proceed",
				"No, commit first",
			]);
			if (choice !== "Yes, proceed") {
				return { cancel: true };
			}
		}

		return undefined;
	});

	pi.on("session_before_fork", async (_event, ctx) => {
		const dirty = await isRepoDirty(pi);
		if (!dirty) return undefined;

		if (!ctx.hasUI) return undefined;

		const choice = await ctx.ui.select(`You have uncommitted git changes. Fork anyway?`, [
			"Yes, fork",
			"No, commit first",
		]);

		if (choice !== "Yes, fork") {
			return { cancel: true };
		}

		return undefined;
	});

	// --- /audit command ---
	pi.registerCommand("audit", {
		description: "Show the security gate audit log",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/audit requires interactive mode", "error");
				return;
			}

			if (state.auditLog.length === 0) {
				ctx.ui.notify("No audit entries recorded.", "info");
				return;
			}

			const lines = [...state.auditLog]
				.reverse()
				.slice(0, 20)
				.map((entry) => {
					const time = new Date(entry.timestamp).toLocaleTimeString();
					const icon = entry.decision === "blocked" ? "🚫" : entry.decision === "confirmed" ? "⚠️" : "✅";
					return `  ${icon} [${time}] ${entry.tool}: ${entry.target.slice(0, 60)}${entry.target.length > 60 ? "..." : ""} → ${entry.decision}${entry.reason ? ` (${entry.reason})` : ""}`;
				});

			ctx.ui.notify(
				`Security Gate Audit Log (last ${Math.min(20, state.auditLog.length)}):\n\n${lines.join("\n")}`,
				"info",
			);
		},
	});
}
