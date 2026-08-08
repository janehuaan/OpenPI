import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const values = new Map();
for (let index = 0; index < args.length; index += 2) {
	const name = args[index];
	const value = args[index + 1];
	if (!name?.startsWith("--") || !value) {
		throw new Error("Usage: node scripts/update-openpi-upstream-version.mjs --repository <owner/repo> --ref <ref> --commit <sha>");
	}
	values.set(name.slice(2), value);
}

const repository = values.get("repository");
const ref = values.get("ref");
const commit = values.get("commit");
if (!repository || !ref || !commit) {
	throw new Error("Missing required upstream version fields.");
}

const root = resolve(import.meta.dirname, "..");
const versionFile = resolve(root, "openpi-upstream.json");
const packageFile = resolve(root, "package.json");
const packageJson = JSON.parse(readFileSync(packageFile, "utf8"));
const existing = JSON.parse(readFileSync(versionFile, "utf8"));

const next = {
	schemaVersion: 1,
	openpiVersion: packageJson.version,
	upstream: {
		repository,
		ref,
		commit,
		lastSyncedAt: new Date().toISOString().slice(0, 10),
	},
};

if (existing.schemaVersion !== 1) {
	throw new Error(`Unsupported openpi-upstream.json schema: ${String(existing.schemaVersion)}`);
}

writeFileSync(versionFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
