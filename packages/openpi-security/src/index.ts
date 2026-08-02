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
 * - permissive: Ask only for HIGH, pass MEDIUM/LOW silently
 * - bypass: Allow everything except CRITICAL (destructive to system/project)
 *
 * Usage:
 *   pi -e packages/openpi-security/src/index.ts
 *   pi -e packages/openpi-security/src/index.ts --security-gate-mode strict
 */

import * as fs from "node:fs";
import * as nodePath from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { classifyCommand, classifyWriteEdit, describeCommand } from "./rules.ts";

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

function appendAuditFile(cwd: string, entry: AuditLog): void {
	try {
		const dir = nodePath.join(cwd, ".pi", "security");
		fs.mkdirSync(dir, { recursive: true });
		fs.appendFileSync(nodePath.join(dir, "audit.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
	} catch {
		// Disk audit is best-effort.
	}
}

function logAudit(
	state: SecurityState,
	tool: string,
	target: string,
	decision: AuditLog["decision"],
	reason?: string,
	cwd?: string,
) {
	const entry: AuditLog = {
		timestamp: Date.now(),
		action: tool,
		tool,
		target,
		decision,
		reason,
	};
	state.auditLog.push(entry);
	// Keep last 100 entries
	if (state.auditLog.length > 100) {
		state.auditLog = state.auditLog.slice(-100);
	}
	if (cwd) appendAuditFile(cwd, entry);
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
	let mode: "strict" | "confirm" | "permissive" | "bypass" = "confirm";

	pi.registerFlag("security-gate-mode", {
		description: "Security gate enforcement mode: strict, confirm, permissive, or bypass",
		type: "string",
	});

	pi.on("session_start", async (_event, ctx) => {
		state = reconstructState(ctx);
		// Priority: CLI flag > user security.json > openpi.json > confirm.
		// The policy is user-scoped so switching workspaces cannot weaken or reset it.
		const flagVal = pi.getFlag("security-gate-mode");
		let configured: string | undefined;
		try {
			const agentDir = process.env.PI_CODING_AGENT_DIR ?? nodePath.join(process.env.HOME ?? "", ".pi", "agent");
			const userCfg = nodePath.join(agentDir, "security.json");
			const productCfg = nodePath.join(agentDir, "openpi.json");
			for (const file of [userCfg, productCfg]) {
				if (!fs.existsSync(file)) continue;
				const value = JSON.parse(fs.readFileSync(file, "utf8")) as {
					mode?: string;
					securityMode?: string;
				};
				const candidate = value.mode ?? value.securityMode;
				if (
					candidate === "strict" ||
					candidate === "confirm" ||
					candidate === "permissive" ||
					candidate === "bypass"
				) {
					configured = candidate;
					break;
				}
			}
		} catch {
			// ignore
		}
		const chosen = typeof flagVal === "string" ? flagVal : configured || "confirm";
		mode = chosen === "strict" || chosen === "permissive" || chosen === "bypass" ? chosen : "confirm";
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
			logAudit(state, "bash", command, "blocked", undefined, ctx.cwd);
			persistState(pi, state);
			return {
				block: true,
				reason: `CRITICAL: ${describeCommand(command) ?? "Dangerous operation"}`,
			};
		}

		// LOW: pass silently
		if (level === "low") return undefined;

		// Bypass: allow everything except CRITICAL (already blocked above)
		if (mode === "bypass") {
			logAudit(state, "bash", command, "allowed", "Bypass mode", ctx.cwd);
			persistState(pi, state);
			return undefined;
		}

		// Check if repo is dirty for medium+ operations
		const dirty = await isRepoDirty(pi);

		if (level === "high") {
			if (mode === "strict") {
				logAudit(state, "bash", command, "blocked", "Strict mode", ctx.cwd);
				persistState(pi, state);
				return {
					block: true,
					reason: `HIGH: Blocked by security gate (strict mode). ${describeCommand(command) ?? "Potentially dangerous operation"}`,
				};
			}

			// Check if already confirmed this session
			const hash = command.slice(0, 50);
			if (state.confirmedHighPaths.includes(hash)) {
				logAudit(state, "bash", command, "allowed", "Previously confirmed", ctx.cwd);
				persistState(pi, state);
				return undefined;
			}

			if (!ctx.hasUI) {
				logAudit(state, "bash", command, "blocked", "No UI for confirmation", ctx.cwd);
				persistState(pi, state);
				return { block: true, reason: "HIGH: No UI available for confirmation" };
			}

			const ruleDesc = describeCommand(command) ?? "Potentially dangerous operation";
			const choice = await ctx.ui.select(
				`⚠️ HIGH risk operation:\n\n  ${command}\n\nTriggered: ${ruleDesc}${dirty ? "\nNote: Uncommitted changes in repo." : ""}\n\nAllow?`,
				["Yes", "No"],
			);

			if (choice === "Yes") {
				state.confirmedHighPaths.push(hash);
				logAudit(state, "bash", command, "confirmed", ruleDesc, ctx.cwd);
				persistState(pi, state);
				return undefined;
			}

			logAudit(state, "bash", command, "blocked", "User denied", ctx.cwd);
			persistState(pi, state);
			return { block: true, reason: `Blocked: ${ruleDesc}` };
		}

		// MEDIUM
		if (level === "medium") {
			if (mode === "strict") {
				logAudit(state, "bash", command, "blocked", "Strict mode", ctx.cwd);
				persistState(pi, state);
				return { block: true, reason: "MEDIUM: Blocked by security gate (strict mode)" };
			}

			// Permissive: pass MEDIUM silently
			if (mode === "permissive") {
				logAudit(state, "bash", command, "allowed", "Permissive mode", ctx.cwd);
				persistState(pi, state);
				return undefined;
			}

			const hash = command.slice(0, 50);
			if (state.confirmedMediumOps.includes(hash)) {
				logAudit(state, "bash", command, "allowed", "Previously confirmed", ctx.cwd);
				persistState(pi, state);
				return undefined;
			}

			if (!ctx.hasUI) {
				logAudit(state, "bash", command, "blocked", "No UI for confirmation", ctx.cwd);
				persistState(pi, state);
				return { block: true, reason: "MEDIUM: No UI available for confirmation" };
			}

			const ruleDesc = describeCommand(command) ?? "Operation requiring attention";
			const choice = await ctx.ui.select(
				`⚠️ MEDIUM risk operation:\n\n  ${command}\n\nTriggered: ${ruleDesc}${dirty ? "\nNote: Uncommitted changes in repo." : ""}\n\nAllow once?`,
				["Yes, allow", "No"],
			);

			if (choice === "Yes, allow") {
				state.confirmedMediumOps.push(hash);
				logAudit(state, "bash", command, "confirmed", ruleDesc, ctx.cwd);
				persistState(pi, state);
				return undefined;
			}

			logAudit(state, "bash", command, "blocked", "User denied", ctx.cwd);
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
			logAudit(state, event.toolName, path, "blocked", undefined, ctx.cwd);
			persistState(pi, state);
			return { block: true, reason: "CRITICAL: Writing to protected system path" };
		}

		if (level === "high") {
			// Bypass: allow protected path writes silently
			if (mode === "bypass") {
				logAudit(state, event.toolName, path, "allowed", "Bypass mode", ctx.cwd);
				persistState(pi, state);
				return undefined;
			}

			if (mode === "strict") {
				logAudit(state, event.toolName, path, "blocked", "Strict mode", ctx.cwd);
				persistState(pi, state);
				return {
					block: true,
					reason: `HIGH: Blocked by security gate (strict mode). Path "${path}" is in a protected directory.`,
				};
			}

			// Permissive: allow protected path writes silently
			if (mode === "permissive") {
				logAudit(state, event.toolName, path, "allowed", "Permissive mode", ctx.cwd);
				persistState(pi, state);
				return undefined;
			}

			if (!ctx.hasUI) {
				logAudit(state, event.toolName, path, "blocked", "No UI", ctx.cwd);
				persistState(pi, state);
				return { block: true, reason: "HIGH: No UI available for confirmation" };
			}

			const choice = await ctx.ui.select(`⚠️ Modifying protected path:\n\n  ${path}\n\nAllow?`, ["Yes", "No"]);

			if (choice === "Yes") {
				logAudit(state, event.toolName, path, "confirmed", undefined, ctx.cwd);
				persistState(pi, state);
				return undefined;
			}

			logAudit(state, event.toolName, path, "blocked", "User denied", ctx.cwd);
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
			if (state.auditLog.length === 0) {
				ctx.ui.notify("No audit entries recorded.", "info");
				return;
			}

			const lines = [...state.auditLog]
				.reverse()
				.slice(0, 20)
				.map((entry) => {
					const time = new Date(entry.timestamp).toLocaleTimeString();
					const icon =
						entry.decision === "blocked" ? "BLOCK" : entry.decision === "confirmed" ? "CONFIRM" : "ALLOW";
					return `  [${icon}] [${time}] ${entry.tool}: ${entry.target.slice(0, 60)}${entry.target.length > 60 ? "..." : ""} → ${entry.decision}${entry.reason ? ` (${entry.reason})` : ""}`;
				});

			ctx.ui.notify(
				`Security Gate Audit Log (last ${Math.min(20, state.auditLog.length)}):\n\n${lines.join("\n")}`,
				"info",
			);
		},
	});

	pi.registerCommand("security", {
		description: "Show security gate mode and summary",
		handler: async (_args, ctx) => {
			const blocked = state.auditLog.filter((entry) => entry.decision === "blocked").length;
			const confirmed = state.auditLog.filter((entry) => entry.decision === "confirmed").length;
			ctx.ui.notify(
				`Security mode: ${mode}\nAudit entries: ${state.auditLog.length} (blocked=${blocked}, confirmed=${confirmed})\nUse /audit for details.`,
				"info",
			);
		},
	});
}
