/**
 * Builtin security gate for the coding agent.
 *
 * Zero-config baseline that intercepts tool calls before extensions run:
 * - bash commands are classified against SECURITY_RULES
 * - write/edit targets are checked against PROTECTED_PATHS
 * - decisions follow a mode matrix (strict / confirm / permissive / bypass)
 * - medium-level command confirmations are cached per session
 * - every block/confirmation decision is appended to an audit log
 *
 * The gate is opt-out: when a securityMode is configured on the session, it is
 * active. Extensions (e.g. openpi-security) still run after the builtin gate.
 */
import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { classifyCommand, classifyWriteEdit, describeCommand, type SecurityLevel } from "./rules.ts";

export type SecurityMode = "strict" | "confirm" | "permissive" | "bypass";

export const SECURITY_MODES: SecurityMode[] = ["strict", "confirm", "permissive", "bypass"];

export function isSecurityMode(value: string | undefined): value is SecurityMode {
	return value !== undefined && (SECURITY_MODES as string[]).includes(value);
}

export type SecurityDecision = "block" | "allow" | "confirm";

export interface SecurityCheckResult {
	decision: SecurityDecision;
	level: SecurityLevel;
	reason?: string;
	/** Cache key for session-level confirm caching (medium-level bash commands only). */
	confirmKey?: string;
}

export interface SecurityAuditEntry {
	timestamp: number;
	tool: string;
	target: string;
	level: SecurityLevel;
	decision: SecurityDecision;
	reason?: string;
	mode: SecurityMode;
}

/** Prefix length used to cache confirmed medium-level commands. */
const CONFIRM_KEY_LENGTH = 80;

export class BuiltinSecurity {
	readonly mode: SecurityMode;
	readonly cwd: string;
	readonly agentDir: string;
	private readonly confirmedCommands = new Set<string>();

	constructor(opts: { mode: SecurityMode; cwd: string; agentDir: string }) {
		this.mode = opts.mode;
		this.cwd = opts.cwd;
		this.agentDir = opts.agentDir;
	}

	/**
	 * Classify a tool call and return the gate decision.
	 *
	 * "confirm" means the caller must ask the user; the caller is responsible
	 * for recording the final decision via {@link recordDecision}.
	 */
	check(toolName: string, target: string): SecurityCheckResult {
		const level = classifyToolCall(toolName, target);
		const reason = describeToolCall(toolName, target);

		switch (level) {
			case "critical":
				return { decision: "block", level, reason: reason ?? "Command is classified as critical" };
			case "high":
				if (this.mode === "bypass") return { decision: "allow", level };
				if (this.mode === "strict") {
					return { decision: "block", level, reason: reason ?? "Command requires confirmation in strict mode" };
				}
				return { decision: "confirm", level, reason: reason ?? "Command requires confirmation" };
			case "medium":
				if (this.mode === "bypass" || this.mode === "permissive") return { decision: "allow", level };
				if (this.mode === "strict") {
					return { decision: "block", level, reason: reason ?? "Command requires confirmation in strict mode" };
				}
				if (toolName === "bash" && this.confirmedCommands.has(commandKey(target))) {
					return { decision: "allow", level };
				}
				return {
					decision: "confirm",
					level,
					reason: reason ?? "Command requires confirmation",
					confirmKey: toolName === "bash" ? commandKey(target) : undefined,
				};
			default:
				return { decision: "allow", level };
		}
	}

	/** Record the outcome of a user confirmation (or lack of UI) for the audit log. */
	recordDecision(toolName: string, target: string, result: SecurityCheckResult, allowed: boolean): void {
		if (allowed && result.confirmKey) {
			this.confirmedCommands.add(result.confirmKey);
		}
		this.appendAudit({
			tool: toolName,
			target,
			level: result.level,
			decision: allowed ? "allow" : "block",
			reason: allowed ? "user confirmed" : "user denied",
			mode: this.mode,
		});
	}

	/** Append an audit entry to <agentDir>/security-audit.jsonl (best effort). */
	appendAudit(entry: Omit<SecurityAuditEntry, "timestamp">): void {
		const auditEntry: SecurityAuditEntry = { timestamp: Date.now(), ...entry };
		try {
			const dir = join(this.agentDir, "security");
			mkdirSync(dir, { recursive: true });
			appendFileSync(join(dir, "audit.jsonl"), `${JSON.stringify(auditEntry)}\n`, "utf8");
		} catch {
			// Disk audit is best-effort; never block tool execution on it.
		}
	}
}

function classifyToolCall(toolName: string, target: string): SecurityLevel {
	if (toolName === "bash") return classifyCommand(target);
	if (toolName === "write" || toolName === "edit") return classifyWriteEdit(target);
	return "low";
}

function describeToolCall(toolName: string, target: string): string | undefined {
	if (toolName === "bash") return describeCommand(target);
	return undefined;
}

function commandKey(command: string): string {
	return command.slice(0, CONFIRM_KEY_LENGTH);
}
