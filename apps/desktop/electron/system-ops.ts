/**
 * Electron main-process native system operations.
 *
 * Direct OS integration for:
 * - Hardware telemetry (CPU, RAM, Battery, Disk)
 * - Port inspection & port process termination (Port Killer)
 * - macOS AppleScript / JXA execution
 * - Silent screen capture & active app detection
 * - System clipboard read/write
 */

import { execFile as execFileCb } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cpus, freemem, loadavg, platform, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { clipboard } from "electron";

const execFile = promisify(execFileCb);

export interface SystemTelemetryData {
	cpu: {
		model: string;
		cores: number;
		loadAvg: number[];
	};
	memory: {
		totalGb: number;
		usedGb: number;
		freeGb: number;
		usagePercent: number;
	};
	disk?: {
		totalGb: number;
		usedGb: number;
		freeGb: number;
		usagePercent: number;
	};
	battery?: {
		hasBattery: boolean;
		percentage?: number;
		charging?: boolean;
		source?: string;
	};
}

export interface PortProcessInfo {
	command: string;
	pid: number;
	user: string;
	node: string;
	port: number;
}

export async function getSystemTelemetry(): Promise<SystemTelemetryData> {
	const cpuList = cpus();
	const total = totalmem();
	const free = freemem();
	const used = total - free;

	const toGb = (bytes: number) => Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10;
	const memory = {
		totalGb: toGb(total),
		usedGb: toGb(used),
		freeGb: toGb(free),
		usagePercent: total > 0 ? Math.round((used / total) * 100) : 0,
	};

	let disk: SystemTelemetryData["disk"];
	try {
		const { stdout } = await execFile("df", ["-k", "/"], { timeout: 3_000 });
		const lines = stdout.trim().split("\n");
		if (lines.length >= 2) {
			const parts = lines[lines.length - 1].trim().split(/\s+/);
			if (parts.length >= 6) {
				const totalBlocks = parseInt(parts[1], 10);
				const usedBlocks = parseInt(parts[2], 10);
				const availBlocks = parseInt(parts[3], 10);
				if (!isNaN(totalBlocks) && !isNaN(usedBlocks) && !isNaN(availBlocks)) {
					const blockToGb = (b: number) => Math.round(((b * 1024) / (1024 * 1024 * 1024)) * 10) / 10;
					disk = {
						totalGb: blockToGb(totalBlocks),
						usedGb: blockToGb(usedBlocks),
						freeGb: blockToGb(availBlocks),
						usagePercent: totalBlocks > 0 ? Math.round((usedBlocks / totalBlocks) * 100) : 0,
					};
				}
			}
		}
	} catch {}

	let battery: SystemTelemetryData["battery"];
	if (platform() === "darwin") {
		try {
			const { stdout } = await execFile("pmset", ["-g", "batt"], { timeout: 3_000 });
			if (stdout && !/No battery/i.test(stdout)) {
				const percentMatch = /(\d+)%/.exec(stdout);
				const chargingMatch = /(charging|discharging|charged|finishing charge)/i.exec(stdout);
				const sourceMatch = /'(.*?)'/i.exec(stdout) || /Now drawing from '(.*?)'/i.exec(stdout);
				battery = {
					hasBattery: Boolean(percentMatch),
					percentage: percentMatch ? parseInt(percentMatch[1], 10) : undefined,
					charging: chargingMatch ? chargingMatch[1].toLowerCase() === "charging" : undefined,
					source: sourceMatch ? sourceMatch[1] : undefined,
				};
			} else {
				battery = { hasBattery: false };
			}
		} catch {}
	}

	return {
		cpu: {
			model: cpuList[0]?.model || "Unknown CPU",
			cores: cpuList.length,
			loadAvg: loadavg(),
		},
		memory,
		disk,
		battery,
	};
}

export async function listListeningPorts(specificPort?: number): Promise<PortProcessInfo[]> {
	try {
		const args = ["-iTCP", "-sTCP:LISTEN", "-P", "-n"];
		if (specificPort) {
			args.unshift(`-iTCP:${specificPort}`);
		}
		const { stdout } = await execFile("lsof", args, { timeout: 5_000 });
		const entries: PortProcessInfo[] = [];
		const lines = stdout.trim().split("\n");
		for (let i = 1; i < lines.length; i++) {
			const parts = lines[i].trim().split(/\s+/);
			if (parts.length >= 9) {
				const command = parts[0];
				const pid = parseInt(parts[1], 10);
				const user = parts[2];
				const node = parts[4] || "TCP";
				const name = parts[parts.length - 2] || parts[parts.length - 1];
				const portMatch = /:(\d+)$/.exec(name);
				const port = portMatch ? parseInt(portMatch[1], 10) : 0;
				if (pid && port) {
					entries.push({ command, pid, user, node, port });
				}
			}
		}
		return entries;
	} catch (error: any) {
		if (error?.code === 1) return [];
		return [];
	}
}

export async function killProcessOnPort(port: number): Promise<{ success: boolean; killed: number[] }> {
	if (!port) throw new Error("Missing port argument");
	const ports = await listListeningPorts(port);
	const killed: number[] = [];
	for (const p of ports) {
		if (p.pid && p.pid > 1) {
			try {
				process.kill(p.pid, "SIGKILL");
				killed.push(p.pid);
			} catch {}
		}
	}
	return { success: true, killed };
}

export async function executeAppleScript(script: string, timeoutMs = 15_000): Promise<string> {
	if (platform() !== "darwin") {
		throw new Error("AppleScript execution is only supported on macOS");
	}
	const { stdout } = await execFile("osascript", ["-e", script], {
		timeout: timeoutMs,
		encoding: "utf8",
	});
	return stdout.trim();
}

export async function getFrontmostApp(): Promise<{ name: string; title: string; url?: string }> {
	if (platform() !== "darwin") {
		return { name: "Desktop", title: "Active Desktop" };
	}
	const script = `
tell application "System Events"
	set frontProc to first application process whose frontmost is true
	set procName to name of frontProc
	set winTitle to ""
	try
		set winTitle to name of front window of frontProc
	end try
	return procName & ":::" & winTitle
end tell`;

	try {
		const out = await executeAppleScript(script, 4_000);
		const [name, title] = out.split(":::");
		let url: string | undefined;

		if (/Google Chrome/i.test(name)) {
			try {
				url = await executeAppleScript('tell application "Google Chrome" to get URL of active tab of front window', 2_000);
			} catch {}
		} else if (/Safari/i.test(name)) {
			try {
				url = await executeAppleScript('tell application "Safari" to get URL of front document', 2_000);
			} catch {}
		}

		return { name: name || "Unknown", title: title || "", url };
	} catch (err: any) {
		return { name: "Desktop", title: err?.message || "" };
	}
}

export async function captureScreenNative(options: { target?: "fullscreen" | "window" | "interactive"; savePath?: string } = {}): Promise<{
	path: string;
	dataUrl?: string;
	cancelled?: boolean;
}> {
	if (platform() !== "darwin") {
		throw new Error("Screen capture is currently only supported natively on macOS");
	}
	const targetPath = options.savePath || join(tmpdir(), `openpi_screen_${Date.now()}.png`);
	const args: string[] = [];
	if (options.target === "interactive") {
		args.push("-i"); // macOS interactive selection crosshairs (like Cmd+Shift+4)
	} else {
		args.push("-x"); // silent
		if (options.target === "window") {
			args.push("-w");
		}
	}
	args.push(targetPath);

	try {
		await execFile("screencapture", args, { timeout: 30_000 });
	} catch (err: any) {
		// User pressed ESC or cancelled
		return { path: "", cancelled: true };
	}

	if (!existsSync(targetPath)) {
		return { path: "", cancelled: true };
	}

	let dataUrl: string | undefined;
	try {
		const base64 = readFileSync(targetPath).toString("base64");
		dataUrl = `data:image/png;base64,${base64}`;
	} catch {}

	return { path: targetPath, dataUrl, cancelled: false };
}

export function readSystemClipboard(): { text: string; hasImage: boolean } {
	const text = clipboard.readText();
	const hasImage = !clipboard.readImage().isEmpty();
	return { text, hasImage };
}

export function writeSystemClipboard(text: string): boolean {
	clipboard.writeText(text);
	return true;
}
