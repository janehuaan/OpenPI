import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface EnableOptions {
	repoRoot?: string;
	agentDir?: string;
	dryRun?: boolean;
	includeIntelligence?: boolean;
	/** Default security mode for openpi-security config. Default confirm. */
	securityMode?: "strict" | "confirm" | "permissive";
	/** Write launchd/systemd unit hints under agentDir/autostart. */
	writeAutostart?: boolean;
}

function findRepoRoot(start: string): string {
	let current = path.resolve(start);
	for (let i = 0; i < 8; i++) {
		if (fs.existsSync(path.join(current, "packages", "openpi-memory"))) return current;
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	throw new Error("Could not find OpenPI monorepo root (packages/openpi-memory missing).");
}

function getAgentDir(override?: string): string {
	if (override) return path.resolve(override);
	if (process.env.PI_CODING_AGENT_DIR) return path.resolve(process.env.PI_CODING_AGENT_DIR);
	return path.join(os.homedir(), ".pi", "agent");
}

function loadJsonObject(file: string): Record<string, unknown> {
	if (!fs.existsSync(file)) return {};
	const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Settings file is not a JSON object: ${file}`);
	}
	return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function writeAutostartUnits(agentDir: string, repoRoot: string, dryRun: boolean): string[] {
	const written: string[] = [];
	const dir = path.join(agentDir, "autostart");
	const orchCli = path.join(repoRoot, "packages/orchestrator/dist/cli.js");
	const node = process.execPath;
	const launchd = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.openpi.orchestrator</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${orchCli}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(agentDir, "orchestrator.stdout.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(agentDir, "orchestrator.stderr.log")}</string>
</dict>
</plist>
`;
	const systemd = `[Unit]
Description=OpenPI Orchestrator
After=network.target

[Service]
Type=simple
ExecStart=${node} ${orchCli} serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
`;
	if (!dryRun) {
		fs.mkdirSync(dir, { recursive: true });
		const launchdPath = path.join(dir, "com.openpi.orchestrator.plist");
		const systemdPath = path.join(dir, "openpi-orchestrator.service");
		fs.writeFileSync(launchdPath, launchd, "utf8");
		fs.writeFileSync(systemdPath, systemd, "utf8");
		written.push(launchdPath, systemdPath);
	} else {
		written.push(path.join(dir, "com.openpi.orchestrator.plist"), path.join(dir, "openpi-orchestrator.service"));
	}
	return written;
}

/**
 * Merge OpenPI first-party extension/skill paths into user settings.json.
 * Also writes openpi product defaults (security mode) and optional autostart units.
 */
export function enableOpenPi(options: EnableOptions = {}): {
	settingsPath: string;
	settings: Record<string, unknown>;
	addedExtensions: string[];
	addedSkills: string[];
	productConfigPath: string;
	autostartFiles: string[];
} {
	const repoRoot = options.repoRoot ?? findRepoRoot(path.join(__dirname, "../.."));
	const agentDir = getAgentDir(options.agentDir);
	const settingsPath = path.join(agentDir, "settings.json");
	const productConfigPath = path.join(agentDir, "openpi.json");
	const securityConfigPath = path.join(agentDir, "security.json");
	const templatePath = path.join(__dirname, "../templates/settings.openpi.json");
	const template = loadJsonObject(templatePath);
	const includeIntelligence = options.includeIntelligence !== false;
	const securityMode = options.securityMode ?? "confirm";

	const current = loadJsonObject(settingsPath);
	const packages = asStringArray(current.packages);
	// pi-web-access already registers tool name "web_search"; loading both kills spawn.
	const hasPiWebAccess = packages.some((entry) => entry.includes("pi-web-access"));

	const extensionRel = asStringArray(template.extensions).filter((entry) => {
		if (!includeIntelligence && entry.includes("openpi-intelligence")) return false;
		// pi-web-access owns web_search / fetch_content; skip openpi web tools to avoid duplicates/conflicts.
		if (hasPiWebAccess && (entry.includes("web-search.ts") || entry.includes("web-fetch.ts"))) return false;
		return true;
	});
	const skillRel = asStringArray(template.skills);

	const absoluteExtensions = extensionRel.map((entry) => path.resolve(repoRoot, entry));
	const absoluteSkills = skillRel.map((entry) => path.resolve(repoRoot, entry));

	for (const file of absoluteExtensions) {
		if (!fs.existsSync(file)) throw new Error(`Missing extension path: ${file}`);
	}
	for (const dir of absoluteSkills) {
		if (!fs.existsSync(dir)) throw new Error(`Missing skills path: ${dir}`);
	}

	const beforeExtensions = asStringArray(current.extensions);
	const beforeSkills = asStringArray(current.skills);
	// Drop openpi web tools if pi-web-access is installed (web_search name conflict; prefer one stack).
	const cleanedBefore = hasPiWebAccess
		? beforeExtensions.filter((entry) => !entry.includes("web-search.ts") && !entry.includes("web-fetch.ts"))
		: beforeExtensions;
	const extensions = unique([...cleanedBefore, ...absoluteExtensions]);
	const skills = unique([...beforeSkills, ...absoluteSkills]);
	const settings: Record<string, unknown> = {
		...current,
		extensions,
		skills,
	};

	const securityExt = path.resolve(repoRoot, "packages/openpi-security/src/index.ts");
	const productConfig = {
		version: 1,
		enabledAt: new Date().toISOString(),
		securityMode,
		defaultTaskTools: ["read", "grep", "find", "ls", "bash"],
		defaultTaskSecurityMode: "strict",
		defaultTaskExtensions: [securityExt],
		chatMode: "rpc",
		repoRoot,
		integrity: {
			// Filled by enable when writeIntegrity is true
			files: {} as Record<string, string>,
		},
	};

	const securityConfig = {
		mode: securityMode,
		auditToDisk: true,
	};

	const autostartFiles =
		options.writeAutostart === false ? [] : writeAutostartUnits(agentDir, repoRoot, Boolean(options.dryRun));

	const integrityFiles: Record<string, string> = {};
	for (const file of absoluteExtensions) {
		integrityFiles[file] = sha256File(file);
	}
	productConfig.integrity = { files: integrityFiles };

	if (!options.dryRun) {
		fs.mkdirSync(agentDir, { recursive: true });
		fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, "\t")}\n`, "utf8");
		fs.writeFileSync(productConfigPath, `${JSON.stringify(productConfig, null, "\t")}\n`, "utf8");
		fs.writeFileSync(securityConfigPath, `${JSON.stringify(securityConfig, null, "\t")}\n`, "utf8");
	}

	return {
		settingsPath,
		settings,
		addedExtensions: absoluteExtensions.filter((entry) => !beforeExtensions.includes(entry)),
		addedSkills: absoluteSkills.filter((entry) => !beforeSkills.includes(entry)),
		productConfigPath,
		autostartFiles,
	};
}

function sha256File(file: string): string {
	const hash = createHash("sha256");
	hash.update(fs.readFileSync(file));
	return hash.digest("hex");
}

/** Verify extension files still match hashes recorded at enable time. */
export function verifyOpenPiIntegrity(agentDir?: string): {
	ok: boolean;
	checked: number;
	mismatches: Array<{ path: string; expected: string; actual: string }>;
	missing: string[];
} {
	const dir = getAgentDir(agentDir);
	const productPath = path.join(dir, "openpi.json");
	if (!fs.existsSync(productPath)) {
		return { ok: false, checked: 0, mismatches: [], missing: [productPath] };
	}
	const product = loadJsonObject(productPath);
	const integrity = product.integrity as { files?: Record<string, string> } | undefined;
	const files = integrity?.files ?? {};
	const mismatches: Array<{ path: string; expected: string; actual: string }> = [];
	const missing: string[] = [];
	let checked = 0;
	for (const [file, expected] of Object.entries(files)) {
		checked += 1;
		if (!fs.existsSync(file)) {
			missing.push(file);
			continue;
		}
		const actual = sha256File(file);
		if (actual !== expected) mismatches.push({ path: file, expected, actual });
	}
	return { ok: mismatches.length === 0 && missing.length === 0, checked, mismatches, missing };
}
