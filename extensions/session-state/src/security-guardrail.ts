/**
 * Security Command Guardrail
 *
 * Intercepts high-risk destructive shell commands before they execute via the
 * `bash` tool, preventing accidental root filesystem wipes, disk formatting,
 * system permission destruction, and fork bombs.
 */

export type RiskCategory =
	| "catastrophic_deletion"
	| "filesystem_format"
	| "permission_tamper"
	| "fork_bomb"
	| "privilege_destruction";

export interface SecurityCheckResult {
	block: boolean;
	category?: RiskCategory;
	reason?: string;
	command?: string;
}

/**
 * Extracts and unquotes the inner command if wrapped in sh -c or bash -c.
 */
export function extractEffectiveCommand(raw: string): string {
	let cmd = raw.trim();
	const wrapperMatch = cmd.match(/^(?:bash|sh|zsh)\s+-c\s+["'](.*)["']$/s);
	if (wrapperMatch && wrapperMatch[1]) {
		cmd = wrapperMatch[1].trim();
	}
	return cmd;
}

/**
 * Normalizes multi-line and whitespace formatting for robust regex matching.
 */
function normalizeCommand(raw: string): string {
	return raw.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Evaluates whether a tool call contains a high-risk destructive command.
 */
export function checkSecurityRisk(toolName: string, input: unknown): SecurityCheckResult {
	if (toolName !== "bash" && toolName !== "user_bash") {
		return { block: false };
	}

	if (!input || typeof input !== "object") {
		return { block: false };
	}

	const obj = input as Record<string, unknown>;
	const rawCommand =
		typeof obj.command === "string" ? obj.command : typeof obj.cmd === "string" ? obj.cmd : "";

	if (!rawCommand.trim()) {
		return { block: false };
	}

	const effective = extractEffectiveCommand(rawCommand);
	const normalized = normalizeCommand(effective);

	// 1. Fork bomb patterns
	if (
		normalized.includes(":(){ :|:& };:") ||
		normalized.includes(":(){:|:&};:") ||
		/perl\s+-e\s+["'].*fork\s+while\s+fork.*["']/.test(normalized)
	) {
		return {
			block: true,
			category: "fork_bomb",
			command: rawCommand,
			reason:
				"[Security Guardrail]: Destructive fork bomb command blocked. System denial-of-service commands are prohibited.",
		};
	}

	// 2. Catastrophic deletion (rm -rf /, rm -rf /*, rm -rf ~, rm -rf $HOME, /etc, /usr, /System, /Library)
	// Matches variations like rm -rf, rm -fr, rm -r -f, rm -f -r
	const rmRfPattern =
		/\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f\b|-[a-zA-Z]*f[a-zA-Z]*r\b|(?:-[a-zA-Z]*r\b\s+-[a-zA-Z]*f\b)|(?:-[a-zA-Z]*f\b\s+-[a-zA-Z]*r\b))\s+(.*)/i;
	const rmMatch = normalized.match(rmRfPattern);
	if (rmMatch && rmMatch[1]) {
		const targets = rmMatch[1]
			.split(/\s+/)
			.map((t) => t.trim().replace(/^["']|["']$/g, ""))
			.filter(Boolean);

		const dangerousRoots = new Set([
			"/",
			"/*",
			"~",
			"~/*",
			"$HOME",
			"$HOME/*",
			"${HOME}",
			"${HOME}/*",
			"/etc",
			"/etc/*",
			"/usr",
			"/usr/*",
			"/bin",
			"/bin/*",
			"/sbin",
			"/sbin/*",
			"/var",
			"/var/*",
			"/System",
			"/System/*",
			"/Library",
			"/Library/*",
		]);

		for (const target of targets) {
			if (dangerousRoots.has(target) || /^\/(?:etc|usr|bin|sbin|var|System|Library)\b(?!\/.*\/)/i.test(target)) {
				return {
					block: true,
					category: "catastrophic_deletion",
					command: rawCommand,
					reason: `[Security Guardrail]: Catastrophic deletion blocked. 'rm -rf' targeted at sensitive system path '${target}'. Operate ONLY within the project workspace using relative paths.`,
				};
			}
		}
	}

	// 3. Low-level drive & filesystem format (mkfs, dd over raw drives, diskutil eraseDisk)
	if (
		/\bmkfs(\.\w+)?\s+/i.test(normalized) ||
		/\bdd\s+.*of=(?:\/dev\/r?disk|\/dev\/sd|\/dev\/nvme)/i.test(normalized) ||
		/>\s*(?:\/dev\/r?disk|\/dev\/sd|\/dev\/nvme)/i.test(normalized) ||
		/\bdiskutil\s+(?:eraseDisk|partitionDisk)\b/i.test(normalized)
	) {
		return {
			block: true,
			category: "filesystem_format",
			command: rawCommand,
			reason:
				"[Security Guardrail]: Raw filesystem formatting or raw disk writing command blocked. Device-level mutation is prohibited.",
		};
	}

	// 4. System root permission tampering (chmod -R 777 /, chown -R /)
	const permPattern = /\b(?:chmod|chown)\s+(?:-[a-zA-Z]*R\s+)?(?:000|777)\s+(.*)/i;
	const permMatch = normalized.match(permPattern);
	if (permMatch && permMatch[1]) {
		const target = permMatch[1].trim();
		if (target === "/" || target === "/*" || target === "~" || target === "$HOME") {
			return {
				block: true,
				category: "permission_tamper",
				command: rawCommand,
				reason: `[Security Guardrail]: Destructive permission modification blocked on system root or home directory '${target}'.`,
			};
		}
	}

	// 5. Destructive Sudo commands
	if (/\bsudo\s+(?:rm\s+-(?:rf|fr)|mkfs|dd|shutdown|reboot|halt|poweroff)\b/i.test(normalized)) {
		return {
			block: true,
			category: "privilege_destruction",
			command: rawCommand,
			reason:
				"[Security Guardrail]: Superuser privilege execution of destructive system command blocked.",
		};
	}

	return { block: false };
}
