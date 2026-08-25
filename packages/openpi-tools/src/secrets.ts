/**
 * Shared secret/env helpers for OpenPI tool extensions.
 *
 * Reads KEY=value lines from `~/.pi/agent/secrets.env` (or PI_CODING_AGENT_DIR),
 * falling back to process env. Keys may be quoted with single or double quotes.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

let secretsCache: Record<string, string> | undefined;

export function loadAgentSecrets(): Record<string, string> {
	if (secretsCache) return secretsCache;
	const out: Record<string, string> = {};
	const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
	const file = join(agentDir, "secrets.env");
	if (!existsSync(file)) {
		secretsCache = out;
		return out;
	}
	try {
		for (const raw of readFileSync(file, "utf8").split("\n")) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq <= 0) continue;
			const key = line.slice(0, eq).trim();
			let value = line.slice(eq + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			if (key) out[key] = value;
		}
	} catch {
		// ignore unreadable secrets file
	}
	secretsCache = out;
	return out;
}

/** Resolve a value from process env first, then ~/.pi/agent/secrets.env. */
export function envOrSecret(...names: string[]): string | undefined {
	const secrets = loadAgentSecrets();
	for (const name of names) {
		const fromEnv = process.env[name]?.trim();
		if (fromEnv) return fromEnv;
		const fromFile = secrets[name]?.trim();
		if (fromFile) return fromFile;
	}
	return undefined;
}
