import { describe, it, expect } from "vitest";
import { checkSecurityRisk, extractEffectiveCommand } from "../src/security-guardrail.ts";

describe("Security Command Guardrail", () => {
	it("unwraps sh/bash -c wrappers correctly", () => {
		expect(extractEffectiveCommand("bash -c 'rm -rf /'")).toBe("rm -rf /");
		expect(extractEffectiveCommand('sh -c "echo hello"')).toBe("echo hello");
		expect(extractEffectiveCommand("git status")).toBe("git status");
	});

	it("blocks catastrophic root/home deletions", () => {
		const dangerous = [
			"rm -rf /",
			"rm -rf /*",
			"rm -fr /",
			"rm -r -f /",
			"rm -rf ~",
			"rm -rf $HOME",
			"rm -rf /etc",
			"rm -rf /usr",
			"rm -rf /System",
			"bash -c 'rm -rf /'",
		];

		for (const cmd of dangerous) {
			const res = checkSecurityRisk("bash", { command: cmd });
			expect(res.block, `Expected '${cmd}' to be blocked`).toBe(true);
			expect(res.category).toBe("catastrophic_deletion");
		}
	});

	it("allows safe project deletions inside workspace", () => {
		const safe = [
			"rm -rf ./dist",
			"rm -rf build",
			"rm -rf node_modules",
			"rm -rf /Users/developer/my-project/temp",
			"rm file.txt",
			"git clean -fd",
		];

		for (const cmd of safe) {
			const res = checkSecurityRisk("bash", { command: cmd });
			expect(res.block, `Expected '${cmd}' to be allowed`).toBe(false);
		}
	});

	it("blocks filesystem formatting and raw disk overwrites", () => {
		const formatting = [
			"mkfs.ext4 /dev/sda1",
			"dd if=/dev/zero of=/dev/rdisk1 bs=1m",
			"diskutil eraseDisk APFS Clean /dev/disk2",
		];

		for (const cmd of formatting) {
			const res = checkSecurityRisk("bash", { command: cmd });
			expect(res.block, `Expected '${cmd}' to be blocked`).toBe(true);
			expect(res.category).toBe("filesystem_format");
		}
	});

	it("blocks root permission destruction and fork bombs", () => {
		const bomb = checkSecurityRisk("bash", { command: ":(){ :|:& };:" });
		expect(bomb.block).toBe(true);
		expect(bomb.category).toBe("fork_bomb");

		const perm = checkSecurityRisk("bash", { command: "chmod -R 777 /" });
		expect(perm.block).toBe(true);
		expect(perm.category).toBe("permission_tamper");

		const sudoDestroy = checkSecurityRisk("bash", { command: "sudo rm -rf /etc" });
		expect(sudoDestroy.block).toBe(true);
	});

	it("ignores non-bash tools", () => {
		const res = checkSecurityRisk("read", { path: "/etc/hosts" });
		expect(res.block).toBe(false);
	});
});
