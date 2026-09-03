import type { TaskSchedule } from "./types.ts";

function parseNumber(value: string, minimum: number, maximum: number, label: string): number {
	const number = Number(value);
	if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`Invalid ${label}: ${value}`);
	return number;
}

function matchesField(field: string, value: number, minimum: number, maximum: number, label: string): boolean {
	if (field === "*") return true;
	if (field.startsWith("*/")) return value % parseNumber(field.slice(2), 1, maximum, label) === 0;
	return field.split(",").some((part) => {
		if (part.includes("-")) {
			const [start, end] = part.split("-");
			return (
				value >= parseNumber(start, minimum, maximum, label) && value <= parseNumber(end, minimum, maximum, label)
			);
		}
		return value === parseNumber(part, minimum, maximum, label);
	});
}

interface WallClockParts {
	minute: number;
	hour: number;
	dayOfMonth: number;
	month: number;
	dayOfWeek: number;
}

function utcParts(date: Date): WallClockParts {
	return {
		minute: date.getUTCMinutes(),
		hour: date.getUTCHours(),
		dayOfMonth: date.getUTCDate(),
		month: date.getUTCMonth() + 1,
		dayOfWeek: date.getUTCDay(),
	};
}

function wallClockParts(date: Date, timezone: string): WallClockParts {
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		weekday: "short",
		hourCycle: "h23",
	});
	const parts = formatter.formatToParts(date);
	const read = (type: Intl.DateTimeFormatPartTypes): string => {
		const part = parts.find((entry) => entry.type === type);
		if (!part) throw new Error(`Unable to resolve ${type} for timezone ${timezone}.`);
		return part.value;
	};
	const weekday = read("weekday").toLowerCase();
	const weekdayMap: Record<string, number> = {
		sun: 0,
		mon: 1,
		tue: 2,
		wed: 3,
		thu: 4,
		fri: 5,
		sat: 6,
	};
	const dayOfWeek = weekdayMap[weekday.slice(0, 3)];
	if (dayOfWeek === undefined) throw new Error(`Unable to resolve weekday for timezone ${timezone}.`);
	return {
		minute: Number(read("minute")),
		hour: Number(read("hour")),
		dayOfMonth: Number(read("day")),
		month: Number(read("month")),
		dayOfWeek,
	};
}

function assertValidTimezone(timezone: string): void {
	try {
		Intl.DateTimeFormat(undefined, { timeZone: timezone });
	} catch {
		throw new Error(`Invalid IANA timezone: ${timezone}`);
	}
}

export function nextRunForSchedule(schedule: TaskSchedule, after: Date): string {
	if (schedule.kind === "once") {
		const timestamp = Date.parse(schedule.runAt);
		if (!Number.isFinite(timestamp)) throw new Error(`Invalid runAt: ${schedule.runAt}`);
		return new Date(timestamp).toISOString();
	}
	const timezone = schedule.timezone && schedule.timezone !== "UTC" ? schedule.timezone : undefined;
	if (timezone) assertValidTimezone(timezone);
	const fields = schedule.expression.trim().split(/\s+/);
	if (fields.length !== 5) throw new Error("Cron expression must contain five fields.");
	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
	const candidate = new Date(after.getTime());
	candidate.setUTCSeconds(0, 0);
	candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
	const limit = candidate.getTime() + 366 * 24 * 60 * 60 * 1000;
	while (candidate.getTime() <= limit) {
		const parts = timezone ? wallClockParts(candidate, timezone) : utcParts(candidate);
		if (
			matchesField(minute, parts.minute, 0, 59, "minute") &&
			matchesField(hour, parts.hour, 0, 23, "hour") &&
			matchesField(dayOfMonth, parts.dayOfMonth, 1, 31, "day of month") &&
			matchesField(month, parts.month, 1, 12, "month") &&
			matchesField(dayOfWeek, parts.dayOfWeek, 0, 6, "day of week")
		) {
			return candidate.toISOString();
		}
		candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
	}
	throw new Error("Cron expression has no matching time within one year.");
}
