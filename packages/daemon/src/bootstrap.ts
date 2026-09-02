/**
 * One-time credential bootstrap (decision B).
 *
 * A freshly created agent dir has no providers, so every real model call fails
 * with 401 (seen in the Phase 0 spike). Rather than build a login UI before the
 * daemon can do anything useful, we import the user's existing pi CLI config
 * once, on first run.
 *
 * Import is one-way and one-time: after the marker is written we never read the
 * user's dir again, so later edits on either side stay independent. Deleting
 * the marker re-runs it.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentDir, globalAgentDir } from "./config.ts";

/** Files worth importing. Anything holding a secret is copied, never logged. */
const IMPORT_FILES = ["models.json", "auth.json", "models-store.json"];

export interface BootstrapResult {
	imported: string[];
	skipped: string[];
	providers: string[];
	alreadyBootstrapped: boolean;
}

function markerPath(): string {
	return join(agentDir(), ".bootstrapped");
}

/** Provider ids in an agent dir's models.json, for reporting. Never returns secrets. */
export function listProviders(dir: string): string[] {
	const file = join(dir, "models.json");
	if (!existsSync(file)) return [];
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as { providers?: Record<string, unknown> };
		return Object.keys(parsed.providers ?? {});
	} catch {
		return [];
	}
}

/**
 * Copy provider config from the user's pi CLI dir into openpi's isolated agent
 * dir. Returns what happened; callers surface this to the user so an empty
 * import is visible rather than showing up later as a 401.
 */
export function bootstrapCredentials(options: { force?: boolean } = {}): BootstrapResult {
	const target = agentDir();
	mkdirSync(target, { recursive: true });

	if (!options.force && existsSync(markerPath())) {
		return { imported: [], skipped: [], providers: listProviders(target), alreadyBootstrapped: true };
	}

	const source = globalAgentDir();
	const imported: string[] = [];
	const skipped: string[] = [];

	for (const name of IMPORT_FILES) {
		const from = join(source, name);
		const to = join(target, name);
		if (!existsSync(from)) {
			skipped.push(name);
			continue;
		}
		// Never clobber config openpi already has - the user may have logged in here.
		if (existsSync(to) && !options.force) {
			skipped.push(name);
			continue;
		}
		copyFileSync(from, to);
		imported.push(name);
	}

	writeFileSync(markerPath(), `${new Date().toISOString()}\n`, "utf8");
	return { imported, skipped, providers: listProviders(target), alreadyBootstrapped: false };
}
