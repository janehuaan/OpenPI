import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { verifyOpenPiIntegrity } from "./enable.ts";

export interface DoctorResult {
	ok: boolean;
	checks: Array<{ name: string; ok: boolean; detail: string }>;
}

function getAgentDir(): string {
	if (process.env.PI_CODING_AGENT_DIR) return process.env.PI_CODING_AGENT_DIR;
	return join(homedir(), ".pi", "agent");
}

function checkFile(path: string, label: string): { name: string; ok: boolean; detail: string } {
	if (!existsSync(path)) return { name: label, ok: false, detail: `missing: ${path}` };
	return { name: label, ok: true, detail: path };
}

/**
 * Diagnose OpenPI personal-agent setup on this machine.
 */
export function runDoctor(options: { agentDir?: string } = {}): DoctorResult {
	const agentDir = options.agentDir ?? getAgentDir();
	const checks: DoctorResult["checks"] = [];

	const settingsPath = join(agentDir, "settings.json");
	const productPath = join(agentDir, "openpi.json");
	const securityPath = join(agentDir, "security.json");
	checks.push(checkFile(settingsPath, "settings.json"));
	checks.push(checkFile(productPath, "openpi.json"));
	checks.push(checkFile(securityPath, "security.json"));

	if (existsSync(settingsPath)) {
		try {
			const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { extensions?: string[] };
			const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
			const required = ["openpi-memory", "openpi-security", "openpi-tools", "openpi-intelligence"];
			const missing = required.filter((name) => !extensions.some((entry) => entry.includes(name)));
			checks.push({
				name: "core extensions enabled",
				ok: missing.length === 0,
				detail:
					missing.length === 0
						? `${extensions.filter((entry) => entry.includes("openpi-")).length} openpi extensions`
						: `missing: ${missing.join(", ")}`,
			});
			const broken = extensions.filter((entry) => entry.includes("openpi-") && !existsSync(entry));
			checks.push({
				name: "extension paths exist",
				ok: broken.length === 0,
				detail: broken.length === 0 ? "all openpi extension paths resolve" : `missing paths: ${broken.join(", ")}`,
			});
		} catch (error) {
			checks.push({
				name: "settings parse",
				ok: false,
				detail: error instanceof Error ? error.message : String(error),
			});
		}
	}

	if (existsSync(productPath)) {
		try {
			const product = JSON.parse(readFileSync(productPath, "utf8")) as {
				securityMode?: string;
				defaultTaskSecurityMode?: string;
				repoRoot?: string;
			};
			checks.push({
				name: "security defaults",
				ok: Boolean(product.securityMode && product.defaultTaskSecurityMode),
				detail: `interactive=${product.securityMode ?? "?"} tasks=${product.defaultTaskSecurityMode ?? "?"}`,
			});
			if (product.repoRoot) {
				checks.push({
					name: "repo root",
					ok: existsSync(product.repoRoot),
					detail: product.repoRoot,
				});
			}
		} catch (error) {
			checks.push({
				name: "openpi.json parse",
				ok: false,
				detail: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const integrity = verifyOpenPiIntegrity(agentDir);
	checks.push({
		name: "integrity hashes",
		ok: integrity.ok || integrity.checked === 0,
		detail:
			integrity.checked === 0
				? "no integrity records (run openpi-enable)"
				: integrity.ok
					? `${integrity.checked} files match`
					: `${integrity.mismatches.length} mismatches, ${integrity.missing.length} missing`,
	});

	const socket = join(process.env.PI_ORCHESTRATOR_DIR ?? join(homedir(), ".pi", "orchestrator"), "orchestrator.sock");
	checks.push({
		name: "orchestrator socket",
		ok: true,
		detail: existsSync(socket) ? `present: ${socket}` : `not running (${socket}) — start with: pi task daemon start`,
	});

	return { ok: checks.every((check) => check.ok || check.name === "orchestrator socket"), checks };
}
