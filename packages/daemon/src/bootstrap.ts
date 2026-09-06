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

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentDir, globalAgentDir, openpiDir } from "./config.ts";

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

/** Synchronize bundled runtime extensions into openpi's isolated agent/extensions dir. */
export function syncRuntimeExtensions(): string[] {
	const target = join(agentDir(), "extensions");
	mkdirSync(target, { recursive: true });

	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(here, "extensions"),
		join(here, "../../../apps/desktop/runtime/extensions"),
		join(process.cwd(), "apps/desktop/runtime/extensions"),
	];

	const sourceDir = candidates.find((d) => existsSync(d) && readdirSync(d).some((f) => f.endsWith(".js")));
	if (!sourceDir) return [];

	const copied: string[] = [];
	try {
		const files = readdirSync(sourceDir).filter((f) => f.endsWith(".js"));
		for (const file of files) {
			const src = join(sourceDir, file);
			const dst = join(target, file);
			try {
				copyFileSync(src, dst);
				copied.push(file);
			} catch {}
		}
	} catch {}
	return copied;
}

/** Auto-migrate legacy ~/.pi/memory files to ~/.openpi/memory if target is uninitialized. */
export function migrateLegacyMemory(): boolean {
	const legacyDir = join(homedir(), ".pi", "memory");
	const targetDir = join(openpiDir(), "memory");
	if (!existsSync(legacyDir)) return false;
	mkdirSync(targetDir, { recursive: true });

	const targetIndex = join(targetDir, "MEMORY.md");
	if (existsSync(targetIndex)) return false;

	try {
		const files = readdirSync(legacyDir);
		for (const file of files) {
			const src = join(legacyDir, file);
			const dst = join(targetDir, file);
			try {
				copyFileSync(src, dst);
			} catch {}
		}
		return true;
	} catch {
		return false;
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

	syncRuntimeExtensions();
	migrateLegacyMemory();

	if (!options.force && existsSync(markerPath())) {
		return { imported: [], skipped: [], providers: listProviders(target), alreadyBootstrapped: true };
	}

	const source = globalAgentDir();
	const imported: string[] = [];
	const skipped: string[] = [];

	// Import default provider and model from settings.json if present
	const sourceSettings = join(source, "settings.json");
	const targetSettings = join(target, "settings.json");
	if (existsSync(sourceSettings) && (!existsSync(targetSettings) || options.force)) {
		try {
			const parsed = JSON.parse(readFileSync(sourceSettings, "utf8"));
			const out: Record<string, unknown> = {};
			if (parsed.defaultProvider) out.defaultProvider = parsed.defaultProvider;
			if (parsed.defaultModel) out.defaultModel = parsed.defaultModel;
			if (parsed.defaultThinkingLevel) out.defaultThinkingLevel = parsed.defaultThinkingLevel;
			writeFileSync(targetSettings, JSON.stringify(out, null, 2) + "\n", "utf8");
			imported.push("settings.json");
		} catch {}
	}

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
