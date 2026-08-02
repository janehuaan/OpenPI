#!/usr/bin/env node
import { runDoctor } from "./doctor.ts";
import { enableOpenPi, verifyOpenPiIntegrity } from "./enable.ts";

function printHelp(): void {
	console.log(`openpi-enable

Commands:
  openpi-enable                 Enable OpenPI packages in user settings
  openpi-enable verify          Verify extension integrity hashes
  openpi-enable doctor          Diagnose setup (settings, paths, integrity)

Flags (enable):
  --dry-run
  --no-intelligence
  --security-mode strict|confirm|permissive
  --no-autostart
  --repo /path/to/OpenPI
  --agent-dir /path/to/agent

Environment:
  PI_CODING_AGENT_DIR
`);
}

function main(): void {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		printHelp();
		return;
	}

	if (args[0] === "doctor") {
		const agentIndex = args.indexOf("--agent-dir");
		const result = runDoctor({ agentDir: agentIndex >= 0 ? args[agentIndex + 1] : undefined });
		for (const check of result.checks) {
			console.log(`${check.ok ? "OK  " : "FAIL"} ${check.name}: ${check.detail}`);
		}
		console.log(result.ok ? "\nDoctor: healthy" : "\nDoctor: issues found (run openpi-enable)");
		if (!result.ok) process.exit(1);
		return;
	}

	if (args[0] === "verify") {
		const agentIndex = args.indexOf("--agent-dir");
		const result = verifyOpenPiIntegrity(agentIndex >= 0 ? args[agentIndex + 1] : undefined);
		console.log(`Integrity check: ${result.ok ? "OK" : "FAILED"} (${result.checked} files)`);
		for (const missing of result.missing) console.log(`  missing: ${missing}`);
		for (const mismatch of result.mismatches) {
			console.log(`  mismatch: ${mismatch.path}`);
			console.log(`    expected: ${mismatch.expected}`);
			console.log(`    actual:   ${mismatch.actual}`);
		}
		if (!result.ok) process.exit(1);
		return;
	}

	const dryRun = args.includes("--dry-run");
	const includeIntelligence = !args.includes("--no-intelligence");
	const writeAutostart = !args.includes("--no-autostart");
	const repoIndex = args.indexOf("--repo");
	const agentIndex = args.indexOf("--agent-dir");
	const modeIndex = args.indexOf("--security-mode");
	const securityModeRaw = modeIndex >= 0 ? args[modeIndex + 1] : "confirm";
	const securityMode =
		securityModeRaw === "strict" || securityModeRaw === "permissive" || securityModeRaw === "confirm"
			? securityModeRaw
			: "confirm";
	const result = enableOpenPi({
		dryRun,
		includeIntelligence,
		writeAutostart,
		securityMode,
		repoRoot: repoIndex >= 0 ? args[repoIndex + 1] : undefined,
		agentDir: agentIndex >= 0 ? args[agentIndex + 1] : undefined,
	});
	console.log(dryRun ? "Dry run — would write:" : "Wrote:");
	console.log(`  ${result.settingsPath}`);
	console.log(`  ${result.productConfigPath}`);
	console.log(`  security mode: ${securityMode}`);
	console.log(`  +${result.addedExtensions.length} extensions`);
	console.log(`  +${result.addedSkills.length} skills`);
	if (result.addedExtensions.length) {
		for (const entry of result.addedExtensions) console.log(`    extension ${entry}`);
	}
	if (result.addedSkills.length) {
		for (const entry of result.addedSkills) console.log(`    skill ${entry}`);
	}
	if (result.autostartFiles.length) {
		console.log("  autostart units:");
		for (const file of result.autostartFiles) console.log(`    ${file}`);
		console.log("  macOS: launchctl load ~/Library/LaunchAgents/com.openpi.orchestrator.plist (copy from above)");
		console.log("  Linux: systemctl --user enable --now openpi-orchestrator.service (copy unit)");
	}
	console.log("\nNext: run `pi` from any directory. Extensions load from settings.");
	console.log("Check: node --experimental-strip-types packages/openpi-bootstrap/src/cli.ts doctor");
}

main();
