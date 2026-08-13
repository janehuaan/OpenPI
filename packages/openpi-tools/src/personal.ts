/**
 * Personal-life tools for OpenPI personal agent sessions.
 *
 * - `calendar`   : list calendar events (OPENPI_CALENDAR_CLI, icalBuddy, gcalcli)
 * - `email_inbox`: summarize recent email (OPENPI_EMAIL_CLI, himalaya, notmuch)
 * - `notify`     : send a desktop notification (OPENPI_NOTIFY_CLI, osascript, notify-send)
 * - `weather`    : current + forecast via wttr.in (no key, network only)
 *
 * Calendar/email are read-only adapters over external CLIs; without a configured
 * CLI they return a clear "not configured" message instead of failing silently.
 */

import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================================================================
// Shared helpers
// ============================================================================

function runCommand(command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.once("error", (error) => {
			resolve({ code: 127, stdout: "", stderr: error.message });
		});
		child.once("close", (code) => {
			resolve({
				code: code ?? 1,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			});
		});
	});
}

function runShell(script: string): Promise<{ code: number; stdout: string; stderr: string }> {
	return runCommand("sh", ["-c", script]);
}

function notConfigured(name: string, envVar: string, fallbacks: string): string {
	return [
		`${name} is not configured on this machine.`,
		`Set ${envVar} to a shell command that prints the data, e.g.`,
		`  ${envVar}='${fallbacks}'`,
		"",
		"Without a configured CLI there is nothing to read.",
	].join("\n");
}

// ============================================================================
// Calendar
// ============================================================================

const CalendarParams = Type.Object({
	date: Type.Optional(
		Type.String({
			description:
				"Which day to show, e.g. today, tomorrow, or YYYY-MM-DD. Default: today. Some CLIs (icalBuddy) only support today's events.",
		}),
	),
});

async function runCalendar(date?: string): Promise<string> {
	const configured = process.env.OPENPI_CALENDAR_CLI?.trim();
	const isToday = !date || date === "today" || date === "今天";
	if (configured) {
		const res = await runShell(configured);
		if (res.code !== 0) {
			return `Calendar CLI failed (exit ${res.code}): ${res.stderr || res.stdout || "unknown error"}`;
		}
		return res.stdout.trim() || "(no output from calendar CLI)";
	}
	if (isToday) {
		const res = await runCommand("icalBuddy", ["eventsToday"]);
		if (res.code === 0 && res.stdout.trim()) {
			return res.stdout.trim();
		}
		const gcal = await runCommand("gcalcli", ["agenda"]);
		if (gcal.code === 0 && gcal.stdout.trim()) {
			return gcal.stdout.trim();
		}
		return notConfigured("Calendar", "OPENPI_CALENDAR_CLI", "icalBuddy eventsToday");
	}
	return notConfigured("Calendar (date range)", "OPENPI_CALENDAR_CLI", "icalBuddy eventsFrom:today to:tomorrow");
}

// ============================================================================
// Email inbox
// ============================================================================

const EmailParams = Type.Object({
	limit: Type.Optional(Type.Number({ description: "Maximum number of messages to fetch. Default: 10." })),
});

async function runEmailInbox(limit: number): Promise<string> {
	const configured = process.env.OPENPI_EMAIL_CLI?.trim();
	if (configured) {
		const res = await runShell(configured);
		if (res.code !== 0) {
			return `Email CLI failed (exit ${res.code}): ${res.stderr || res.stdout || "unknown error"}`;
		}
		return res.stdout.trim() || "(no output from email CLI)";
	}
	const himalaya = await runCommand("himalaya", ["envelope", "list", "--page-size", String(limit)]);
	if (himalaya.code === 0 && himalaya.stdout.trim()) {
		return himalaya.stdout.trim();
	}
	const notmuch = await runCommand("notmuch", ["search", "--output=summary", "tag:inbox", `limit:${limit}`]);
	if (notmuch.code === 0 && notmuch.stdout.trim()) {
		return notmuch.stdout.trim();
	}
	return notConfigured("Email inbox", "OPENPI_EMAIL_CLI", "himalaya envelope list");
}

// ============================================================================
// Notify
// ============================================================================

const NotifyParams = Type.Object({
	title: Type.String({ description: "Notification title." }),
	body: Type.String({ description: "Notification body text." }),
});

async function runNotify(title: string, body: string): Promise<string> {
	const template = process.env.OPENPI_NOTIFY_CLI?.trim();
	if (template) {
		const script = template.replaceAll("{title}", title).replaceAll("{body}", body).replaceAll("{message}", body);
		const res = await runShell(script);
		if (res.code !== 0) {
			return `Notification command failed (exit ${res.code}): ${res.stderr || "unknown error"}`;
		}
		return "Notification sent.";
	}
	if (process.platform === "darwin") {
		const res = await runCommand("osascript", [
			"-e",
			`display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`,
		]);
		if (res.code === 0) return "Notification sent (osascript).";
		return `Failed to send notification: ${res.stderr || "osascript unavailable"}`;
	}
	if (process.platform === "linux") {
		const res = await runCommand("notify-send", [title, body]);
		if (res.code === 0) return "Notification sent (notify-send).";
		return `Failed to send notification: ${res.stderr || "notify-send unavailable"}`;
	}
	if (process.platform === "win32") {
		const script = `powershell -NoProfile -Command "[System.Windows.Forms.MessageBox]::Show(${JSON.stringify(body)}, ${JSON.stringify(title)})"`;
		const res = await runShell(script);
		if (res.code === 0) return "Notification sent (powershell).";
		return `Failed to send notification: ${res.stderr || "powershell unavailable"}`;
	}
	return "Notification is not supported on this platform.";
}

// ============================================================================
// Weather
// ============================================================================

const WeatherParams = Type.Object({
	location: Type.Optional(
		Type.String({
			description: "City or place name (e.g. Shanghai, beijing, Tokyo). Default: auto-detect by IP via wttr.in.",
		}),
	),
	days: Type.Optional(Type.Number({ description: "Forecast days (1-3). Default: 3." })),
});

interface WttrCurrent {
	temp_C?: string;
	feelsLikeC?: string;
	humidity?: string;
	windspeedKmph?: string;
	weatherDesc?: Array<{ value?: string }>;
}

interface WttrDay {
	date?: string;
	maxtempC?: string;
	mintempC?: string;
	hourly?: Array<{ tempC?: string; weatherDesc?: Array<{ value?: string }> }>;
}

interface WttrPayload {
	current_condition?: WttrCurrent[];
	weather?: WttrDay[];
	nearest_area?: Array<{ areaName?: Array<{ value?: string }> }>;
}

async function runWeather(location: string, days: number): Promise<string> {
	const loc = location.trim() || "";
	const url = `https://wttr.in/${encodeURIComponent(loc)}?format=j1&lang=zh`;
	let payload: WttrPayload;
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 12000);
		try {
			const response = await fetch(url, { signal: controller.signal });
			if (!response.ok) {
				return `Weather fetch failed: HTTP ${response.status}`;
			}
			payload = (await response.json()) as WttrPayload;
		} finally {
			clearTimeout(timer);
		}
	} catch (error) {
		return `Weather fetch failed: ${error instanceof Error ? error.message : String(error)}`;
	}

	const current = payload.current_condition?.[0];
	const area = payload.nearest_area?.[0]?.areaName?.[0]?.value ?? (loc || "当前位置");
	const lines: string[] = [];
	if (current) {
		const desc = current.weatherDesc?.[0]?.value ?? "";
		const parts = [
			desc,
			current.temp_C ? `${current.temp_C}°C` : undefined,
			current.feelsLikeC ? `体感 ${current.feelsLikeC}°C` : undefined,
			current.humidity ? `湿度 ${current.humidity}%` : undefined,
			current.windspeedKmph ? `风速 ${current.windspeedKmph}km/h` : undefined,
		].filter((entry): entry is string => Boolean(entry));
		lines.push(`# ${area}`);
		lines.push(parts.join(" · "));
	} else {
		lines.push(`# ${area}（无当前数据）`);
	}

	const daysToShow = Math.min(3, Math.max(1, days));
	for (const day of payload.weather?.slice(0, daysToShow) ?? []) {
		if (!day.date) continue;
		const range = [day.mintempC, day.maxtempC].filter(Boolean).join(" ~ ");
		const midday = day.hourly?.[Math.floor((day.hourly.length ?? 0) / 2)];
		const desc = midday?.weatherDesc?.[0]?.value ?? "";
		lines.push(`- ${day.date}: ${range}°C${desc ? ` ${desc}` : ""}`);
	}
	return lines.join("\n");
}

// ============================================================================
// Extension registration
// ============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "calendar",
		label: "Calendar",
		description:
			"List calendar events for a day (default today). Read-only; requires OPENPI_CALENDAR_CLI, icalBuddy, or gcalcli to be installed.",
		promptSnippet: "Use calendar to check the user's schedule for a day",
		parameters: CalendarParams,
		async execute(_id, params) {
			const text = await runCalendar(params.date ? String(params.date) : undefined);
			return { content: [{ type: "text", text }], details: undefined };
		},
	});

	pi.registerTool({
		name: "email_inbox",
		label: "Email Inbox",
		description:
			"Summarize recent email (read-only). Requires OPENPI_EMAIL_CLI, himalaya, or notmuch to be installed. Never sends mail.",
		promptSnippet: "Use email_inbox to check unread or recent email",
		parameters: EmailParams,
		async execute(_id, params) {
			const limit = Math.min(50, Math.max(1, params.limit ?? 10));
			const text = await runEmailInbox(limit);
			return { content: [{ type: "text", text }], details: undefined };
		},
	});

	pi.registerTool({
		name: "notify",
		label: "Desktop Notification",
		description:
			"Send a desktop notification to the user. Use for reminders, task completion alerts, and proactive nudges. macOS uses osascript when OPENPI_NOTIFY_CLI is unset.",
		promptSnippet: "Use notify to alert the user with a desktop notification",
		parameters: NotifyParams,
		async execute(_id, params) {
			const text = await runNotify(String(params.title), String(params.body));
			return { content: [{ type: "text", text }], details: undefined };
		},
	});

	pi.registerTool({
		name: "weather",
		label: "Weather",
		description:
			"Current weather and short forecast via wttr.in (no API key). Pass a city name (e.g. Shanghai) or leave empty for IP-based auto-detection.",
		promptSnippet: "Use weather to check current conditions or a short forecast",
		parameters: WeatherParams,
		async execute(_id, params) {
			const text = await runWeather(params.location ? String(params.location) : "", params.days ?? 3);
			return { content: [{ type: "text", text }], details: undefined };
		},
	});
}
