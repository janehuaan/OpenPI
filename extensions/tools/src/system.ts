/**
 * 系统级 Agent 工具集 (System-level Agent Toolset)
 *
 * Provides:
 * 1. system_os:
 *    - run_applescript: Run AppleScript/JXA scripts on macOS
 *    - open_app: Launch or activate an application or file/URL
 *    - reveal_in_finder: Reveal file/folder in macOS Finder
 *    - clipboard_read: Read text from system clipboard
 *    - clipboard_write: Write text to system clipboard
 *    - set_volume: Adjust system audio output volume (0-100)
 *    - media_control: Play/pause/next/prev system media
 *
 * 2. system_screen:
 *    - capture_screen: Silent screenshot capture to file (full screen or window)
 *    - get_active_app: Detect frontmost application and window title
 *
 * 3. system_process:
 *    - get_telemetry: Retrieve CPU, Memory, Disk, and Battery telemetry
 *    - list_ports: List listening TCP ports with PID and command
 *    - kill_port: Terminate process listening on a given port
 *    - kill_process: Terminate process by PID
 */

import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { cpus, freemem, loadavg, platform, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const execFile = promisify(execFileCb);

// ============================================================================
// Telemetry & Parsing Helpers (exported for testing)
// ============================================================================

export interface BatteryInfo {
	hasBattery: boolean;
	percentage?: number;
	charging?: boolean;
	source?: string;
}

export function parsePmsetBattery(output: string): BatteryInfo {
	if (!output || /No battery/i.test(output)) {
		return { hasBattery: false };
	}
	const percentMatch = /(\d+)%/.exec(output);
	const chargingMatch = /(charging|discharging|charged|finishing charge)/i.exec(output);
	const sourceMatch = /'(.*?)'/i.exec(output) || /Now drawing from '(.*?)'/i.exec(output);

	return {
		hasBattery: Boolean(percentMatch),
		percentage: percentMatch ? parseInt(percentMatch[1], 10) : undefined,
		charging: chargingMatch ? chargingMatch[1].toLowerCase() === "charging" : undefined,
		source: sourceMatch ? sourceMatch[1] : undefined,
	};
}

export interface DiskInfo {
	totalGb: number;
	usedGb: number;
	freeGb: number;
	usagePercent: number;
}

export function parseDfOutput(output: string): DiskInfo | undefined {
	const lines = output.trim().split("\n");
	if (lines.length < 2) return undefined;
	// Typical macOS df -k /:
	// Filesystem 1024-blocks Used Available Capacity ... Mounted on
	// /dev/disk3s1s1 482884968 11184768 152640200 7% /
	const parts = lines[lines.length - 1].trim().split(/\s+/);
	if (parts.length < 6) return undefined;
	const totalBlocks = parseInt(parts[1], 10);
	const usedBlocks = parseInt(parts[2], 10);
	const availBlocks = parseInt(parts[3], 10);
	if (isNaN(totalBlocks) || isNaN(usedBlocks) || isNaN(availBlocks)) return undefined;

	const toGb = (blocks: number) => Math.round((blocks * 1024) / (1024 * 1024 * 1024) * 10) / 10;
	const totalGb = toGb(totalBlocks);
	const usedGb = toGb(usedBlocks);
	const freeGb = toGb(availBlocks);
	const usagePercent = totalBlocks > 0 ? Math.round((usedBlocks / totalBlocks) * 100) : 0;

	return { totalGb, usedGb, freeGb, usagePercent };
}

export interface PortEntry {
	command: string;
	pid: number;
	user: string;
	node: string;
	port: number;
}

export function parseLsofOutput(output: string): PortEntry[] {
	const entries: PortEntry[] = [];
	const lines = output.trim().split("\n");
	// COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
	// node 12345 user 22u IPv4 0x... 0t0 TCP *:3000 (LISTEN)
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
}

// ============================================================================
// Core Execution Functions
// ============================================================================

export async function runAppleScript(script: string, timeoutMs = 15_000): Promise<string> {
	if (platform() !== "darwin") {
		throw new Error("AppleScript is only supported on macOS");
	}
	const { stdout } = await execFile("osascript", ["-e", script], {
		timeout: timeoutMs,
		encoding: "utf8",
	});
	return stdout.trim();
}

export async function captureScreenNative(options: { target?: "fullscreen" | "window"; savePath?: string } = {}): Promise<string> {
	if (platform() !== "darwin") {
		throw new Error("Screen capture is currently only supported natively on macOS");
	}
	const targetPath = options.savePath || join(tmpdir(), `openpi_screen_${Date.now()}.png`);
	const args = ["-x"]; // Silent
	if (options.target === "window") {
		args.push("-w"); // Window selection or front window
	}
	args.push(targetPath);

	await execFile("screencapture", args, { timeout: 10_000 });
	if (!existsSync(targetPath)) {
		throw new Error("Screenshot failed to generate output image file");
	}
	return targetPath;
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
		const out = await runAppleScript(script, 5_000);
		const [name, title] = out.split(":::");
		let url: string | undefined;

		// If frontmost app is Chrome or Safari, attempt to get active tab URL
		if (/Google Chrome/i.test(name)) {
			try {
				url = await runAppleScript('tell application "Google Chrome" to get URL of active tab of front window', 3_000);
			} catch {}
		} else if (/Safari/i.test(name)) {
			try {
				url = await runAppleScript('tell application "Safari" to get URL of front document', 3_000);
			} catch {}
		}

		return { name: name || "Unknown", title: title || "", url };
	} catch (err: any) {
		return { name: "Desktop", title: err?.message || "" };
	}
}

export async function getSystemTelemetry(): Promise<{
	cpu: { model: string; cores: number; loadAvg: number[] };
	memory: { totalGb: number; usedGb: number; freeGb: number; usagePercent: number };
	disk?: DiskInfo;
	battery?: BatteryInfo;
}> {
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

	let disk: DiskInfo | undefined;
	try {
		const { stdout } = await execFile("df", ["-k", "/"], { timeout: 3_000 });
		disk = parseDfOutput(stdout);
	} catch {}

	let battery: BatteryInfo | undefined;
	if (platform() === "darwin") {
		try {
			const { stdout } = await execFile("pmset", ["-g", "batt"], { timeout: 3_000 });
			battery = parsePmsetBattery(stdout);
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

export async function getListeningPorts(specificPort?: number): Promise<PortEntry[]> {
	try {
		const args = ["-iTCP", "-sTCP:LISTEN", "-P", "-n"];
		if (specificPort) {
			args.unshift(`-iTCP:${specificPort}`);
		}
		const { stdout } = await execFile("lsof", args, { timeout: 5_000 });
		return parseLsofOutput(stdout);
	} catch (error: any) {
		// lsof exits with 1 if no matching process found
		if (error?.code === 1) return [];
		return [];
	}
}

export async function killProcess(pid: number, signal: "SIGTERM" | "SIGKILL" = "SIGKILL"): Promise<boolean> {
	if (!pid || pid <= 1) throw new Error("Invalid or protected PID");
	process.kill(pid, signal);
	return true;
}

// ============================================================================
// Tool Schema Definitions & Plugin Registration
// ============================================================================

export interface SystemOsDetails {
	action: string;
	success?: boolean;
	target?: string;
	path?: string;
	length?: number;
	volume?: number;
	command?: string;
	error?: string;
}

export interface SystemScreenDetails {
	action: string;
	imagePath?: string;
	name?: string;
	title?: string;
	url?: string;
	error?: string;
}

export interface SystemProcessDetails {
	action: string;
	telemetry?: unknown;
	ports?: PortEntry[];
	port?: number;
	killed?: number[];
	pid?: number;
	error?: string;
}

export default function (pi: ExtensionAPI): void {
	// ── 1. system_os ────────────────────────────────────────────────────────
	pi.registerTool({
		name: "system_os",
		label: "系统自动化与桌面控制",
		description: "Execute OS-level desktop operations on macOS: AppleScript automation, open applications, reveal files in Finder, manage clipboard, and adjust audio volume.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("run_applescript"),
				Type.Literal("open_app"),
				Type.Literal("reveal_in_finder"),
				Type.Literal("clipboard_read"),
				Type.Literal("clipboard_write"),
				Type.Literal("set_volume"),
				Type.Literal("media_control"),
			], { description: "Action to perform on the operating system" }),
			script: Type.Optional(Type.String({ description: "AppleScript source code to execute (for run_applescript)" })),
			appName: Type.Optional(Type.String({ description: "Application name or path (for open_app)" })),
			path: Type.Optional(Type.String({ description: "File or directory path (for open_app, reveal_in_finder)" })),
			text: Type.Optional(Type.String({ description: "Text content to write to clipboard (for clipboard_write)" })),
			volume: Type.Optional(Type.Number({ description: "Volume level 0-100 (for set_volume)" })),
			mediaCommand: Type.Optional(Type.Union([
				Type.Literal("play"),
				Type.Literal("pause"),
				Type.Literal("playpause"),
				Type.Literal("next"),
				Type.Literal("previous"),
			], { description: "Playback control command (for media_control)" })),
		}),
		execute: async (
			_toolCallId,
			params,
		): Promise<{ content: Array<{ type: "text"; text: string }>; details: SystemOsDetails }> => {
			const action = params.action;
			try {
				if (action === "run_applescript") {
					if (!params.script) throw new Error("run_applescript requires a 'script' parameter");
					const result = await runAppleScript(params.script);
					return {
						content: [{ type: "text", text: result || "AppleScript executed successfully." }],
						details: { action, success: true } satisfies SystemOsDetails,
					};
				}

				if (action === "open_app") {
					if (params.appName) {
						await execFile("open", ["-a", params.appName]);
					} else if (params.path) {
						await execFile("open", [params.path]);
					} else {
						throw new Error("open_app requires either 'appName' or 'path'");
					}
					return {
						content: [{ type: "text", text: `Opened ${params.appName || params.path}` }],
						details: { action, target: params.appName || params.path } satisfies SystemOsDetails,
					};
				}

				if (action === "reveal_in_finder") {
					if (!params.path) throw new Error("reveal_in_finder requires 'path'");
					await execFile("open", ["-R", params.path]);
					return {
						content: [{ type: "text", text: `Revealed ${params.path} in Finder.` }],
						details: { action, path: params.path } satisfies SystemOsDetails,
					};
				}

				if (action === "clipboard_read") {
					const { stdout } = await execFile("pbpaste", [], { encoding: "utf8" });
					return {
						content: [{ type: "text", text: stdout || "(Clipboard is empty)" }],
						details: { action, length: stdout.length } satisfies SystemOsDetails,
					};
				}

				if (action === "clipboard_write") {
					const text = params.text ?? "";
					await new Promise<void>((resolve, reject) => {
						const child = execFileCb("pbcopy", (err) => (err ? reject(err) : resolve()));
						child.stdin?.write(text);
						child.stdin?.end();
					});
					return {
						content: [{ type: "text", text: `Copied ${text.length} characters to clipboard.` }],
						details: { action, length: text.length } satisfies SystemOsDetails,
					};
				}

				if (action === "set_volume") {
					const vol = Math.max(0, Math.min(100, Math.round(params.volume ?? 50)));
					await runAppleScript(`set volume output volume ${vol}`);
					return {
						content: [{ type: "text", text: `System output volume set to ${vol}%.` }],
						details: { action, volume: vol } satisfies SystemOsDetails,
					};
				}

				if (action === "media_control") {
					const cmd = params.mediaCommand || "playpause";
					// Control Music.app or Spotify
					const script = `
tell application "System Events"
	if exists (application process "Music") then
		tell application "Music" to ${cmd}
	else if exists (application process "Spotify") then
		tell application "Spotify" to ${cmd}
	end if
end tell`;
					await runAppleScript(script);
					return {
						content: [{ type: "text", text: `Sent media command '${cmd}'.` }],
						details: { action, command: cmd } satisfies SystemOsDetails,
					};
				}

				return {
					content: [{ type: "text", text: `Unknown system_os action: ${action}` }],
					details: { action, error: "invalid_action" } satisfies SystemOsDetails,
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `system_os ${action} failed: ${err?.message || String(err)}` }],
					details: { action, error: err?.message || String(err) } satisfies SystemOsDetails,
				};
			}
		},
	});

	// ── 2. system_screen ────────────────────────────────────────────────────
	pi.registerTool({
		name: "system_screen",
		label: "屏幕感知与前台窗口",
		description: "Inspect the desktop display: silent screen capture (for visual reasoning) and active frontmost window/application detection.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("capture_screen"),
				Type.Literal("get_active_app"),
			], { description: "Screen perception action" }),
			target: Type.Optional(Type.Union([Type.Literal("fullscreen"), Type.Literal("window")], { description: "Capture target" })),
			savePath: Type.Optional(Type.String({ description: "Optional output image file path" })),
		}),
		execute: async (
			_toolCallId,
			params,
		): Promise<{ content: Array<{ type: "text"; text: string }>; details: SystemScreenDetails }> => {
			const action = params.action;
			try {
				if (action === "capture_screen") {
					const imagePath = await captureScreenNative({
						target: params.target || "fullscreen",
						savePath: params.savePath,
					});
					return {
						content: [{
							type: "text",
							text: `Screenshot captured successfully to: ${imagePath}\nYou can inspect and reason on this image with multimodal vision.`,
						}],
						details: { action, imagePath } satisfies SystemScreenDetails,
					};
				}

				if (action === "get_active_app") {
					const info = await getFrontmostApp();
					const detailsText = [
						`Active Application: ${info.name}`,
						info.title ? `Window Title: ${info.title}` : "",
						info.url ? `Tab URL: ${info.url}` : "",
					].filter(Boolean).join("\n");
					return {
						content: [{ type: "text", text: detailsText }],
						details: { action, ...info } satisfies SystemScreenDetails,
					};
				}

				return {
					content: [{ type: "text", text: `Unknown system_screen action: ${action}` }],
					details: { action, error: "invalid_action" } satisfies SystemScreenDetails,
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `system_screen ${action} failed: ${err?.message || String(err)}` }],
					details: { action, error: err?.message || String(err) } satisfies SystemScreenDetails,
				};
			}
		},
	});

	// ── 3. system_process ───────────────────────────────────────────────────
	pi.registerTool({
		name: "system_process",
		label: "系统硬件遥测与端口管理",
		description: "Manage system health, ports, and processes: get CPU/RAM/Battery/Disk telemetry, inspect listening ports, and terminate processes.",
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("get_telemetry"),
				Type.Literal("list_ports"),
				Type.Literal("kill_port"),
				Type.Literal("kill_process"),
			], { description: "Process or system health action" }),
			port: Type.Optional(Type.Number({ description: "TCP port number (for list_ports or kill_port)" })),
			pid: Type.Optional(Type.Number({ description: "Process ID to terminate (for kill_process)" })),
		}),
		execute: async (
			_toolCallId,
			params,
		): Promise<{ content: Array<{ type: "text"; text: string }>; details: SystemProcessDetails }> => {
			const action = params.action;
			try {
				if (action === "get_telemetry") {
					const telemetry = await getSystemTelemetry();
					const lines = [
						`## 硬件遥测 (System Telemetry)`,
						`- CPU: ${telemetry.cpu.model} (${telemetry.cpu.cores} cores, Load: ${telemetry.cpu.loadAvg.map((l) => l.toFixed(2)).join(", ")})`,
						`- 内存: 已用 ${telemetry.memory.usedGb} GB / 总计 ${telemetry.memory.totalGb} GB (${telemetry.memory.usagePercent}%)`,
					];
					if (telemetry.disk) {
						lines.push(`- 磁盘: 已用 ${telemetry.disk.usedGb} GB / 总计 ${telemetry.disk.totalGb} GB (${telemetry.disk.usagePercent}%)`);
					}
					if (telemetry.battery?.hasBattery) {
						lines.push(`- 电池: ${telemetry.battery.percentage}% (${telemetry.battery.charging ? "充电中" : "未充电"}, 电源: ${telemetry.battery.source || "电池"})`);
					}
					return {
						content: [{ type: "text", text: lines.join("\n") }],
						details: { action, telemetry } satisfies SystemProcessDetails,
					};
				}

				if (action === "list_ports") {
					const entries = await getListeningPorts(params.port);
					if (entries.length === 0) {
						return {
							content: [{ type: "text", text: params.port ? `Port ${params.port} is not in use.` : "No active listening TCP ports found." }],
							details: { action, ports: [] } satisfies SystemProcessDetails,
						};
					}
					const header = "| Command | PID | User | Protocol | Port |\n|---|---|---|---|---|";
					const rows = entries.map((e) => `| ${e.command} | ${e.pid} | ${e.user} | ${e.node} | ${e.port} |`);
					return {
						content: [{ type: "text", text: `${header}\n${rows.join("\n")}` }],
						details: { action, ports: entries } satisfies SystemProcessDetails,
					};
				}

				if (action === "kill_port") {
					if (!params.port) throw new Error("kill_port requires 'port' parameter");
					const entries = await getListeningPorts(params.port);
					if (entries.length === 0) {
						return {
							content: [{ type: "text", text: `Port ${params.port} is not occupied by any process.` }],
							details: { action, port: params.port, killed: [] } satisfies SystemProcessDetails,
						};
					}
					const killedPids: number[] = [];
					for (const entry of entries) {
						try {
							await killProcess(entry.pid, "SIGKILL");
							killedPids.push(entry.pid);
						} catch {}
					}
					return {
						content: [{ type: "text", text: `Successfully terminated process(es) on port ${params.port}: PIDs [${killedPids.join(", ")}]` }],
						details: { action, port: params.port, killed: killedPids } satisfies SystemProcessDetails,
					};
				}

				if (action === "kill_process") {
					if (!params.pid) throw new Error("kill_process requires 'pid' parameter");
					await killProcess(params.pid, "SIGKILL");
					return {
						content: [{ type: "text", text: `Process with PID ${params.pid} has been terminated.` }],
						details: { action, pid: params.pid } satisfies SystemProcessDetails,
					};
				}

				return {
					content: [{ type: "text", text: `Unknown system_process action: ${action}` }],
					details: { action, error: "invalid_action" } satisfies SystemProcessDetails,
				};
			} catch (err: any) {
				return {
					content: [{ type: "text", text: `system_process ${action} failed: ${err?.message || String(err)}` }],
					details: { action, error: err?.message || String(err) } satisfies SystemProcessDetails,
				};
			}
		},
	});
}
