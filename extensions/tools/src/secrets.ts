/**
 * Agent-directory and secret resolution, shared by every tool here.
 *
 * openpi keeps its own directory (`~/.openpi/agent`) rather than reading the
 * user's pi CLI directory, so the two never fight over one secrets file. The
 * daemon sets PI_CODING_AGENT_DIR for every session it spawns, which is what
 * normally decides this.
 *
 * The old package had this same logic three times - here, in `feed-utils.ts`,
 * and inline in `web-search.ts` - so a fix in one place missed the others.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Directory holding openpi's agent state (secrets.env, per-tool JSON). */
export function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".openpi", "agent");
}

/** Path to a state file inside the agent directory. */
export function agentStatePath(name: string): string {
	return join(agentDir(), name);
}

let secretsCache: Record<string, string> | undefined;

/**
 * Parse `KEY=value` lines from `<agentDir>/secrets.env`.
 *
 * Values may be single- or double-quoted. Cached for the process lifetime: a
 * tool call must not re-read the file on every invocation.
 */
export function loadAgentSecrets(): Record<string, string> {
	if (secretsCache) return secretsCache;
	const out: Record<string, string> = {};
	const file = agentStatePath("secrets.env");
	if (!existsSync(file)) {
		secretsCache = out;
		return out;
	}
	try {
		for (const raw of readFileSync(file, "utf8").split("\n")) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) continue;
			const equals = line.indexOf("=");
			if (equals <= 0) continue;
			const key = line.slice(0, equals).trim();
			let value = line.slice(equals + 1).trim();
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}
			if (key) out[key] = value;
		}
	} catch {
		// An unreadable secrets file must not stop a tool from running without keys.
	}
	secretsCache = out;
	return out;
}

/** Resolve a value from the process environment first, then secrets.env. */
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

/** Test seam: drop the cached secrets so a changed file is picked up. */
export function clearSecretsCache(): void {
	secretsCache = undefined;
}
