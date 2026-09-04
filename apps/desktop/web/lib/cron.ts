/**
 * Cron expression helpers for the task UI.
 *
 * Validating in the renderer means a bad expression is rejected before it
 * reaches the daemon, where `nextRunForSchedule` would throw and surface as an
 * opaque IPC error. The description is for the form's preview line — the
 * authoritative next-run time still comes from the scheduler.
 */

export interface CronParts {
	minute: string;
	hour: string;
	dayOfMonth: string;
	month: string;
	dayOfWeek: string;
}

const RANGES: Array<[keyof CronParts, number, number, string]> = [
	["minute", 0, 59, "minute"],
	["hour", 0, 23, "hour"],
	["dayOfMonth", 1, 31, "day of month"],
	["month", 1, 12, "month"],
	["dayOfWeek", 0, 6, "day of week"],
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function splitCron(expression: string): CronParts | undefined {
	const fields = expression.trim().split(/\s+/);
	if (fields.length !== 5) return undefined;
	const [minute, hour, dayOfMonth, month, dayOfWeek] = fields as [string, string, string, string, string];
	return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/** Undefined when valid, else a message naming the offending field. */
export function validateCron(expression: string): string | undefined {
	const parts = splitCron(expression);
	if (!parts) return "A cron expression needs five fields: minute hour day month weekday.";

	for (const [key, min, max, label] of RANGES) {
		const field = parts[key];
		if (!isValidField(field, min, max)) return `Invalid ${label}: ${field}`;
	}
	return undefined;
}

function isValidField(field: string, min: number, max: number): boolean {
	if (field === "*") return true;
	if (field.startsWith("*/")) {
		const step = Number(field.slice(2));
		return Number.isInteger(step) && step >= 1 && step <= max;
	}
	return field.split(",").every((part) => {
		if (part.includes("-")) {
			const [start, end] = part.split("-");
			return inRange(start, min, max) && inRange(end, min, max);
		}
		return inRange(part, min, max);
	});
}

function inRange(value: string | undefined, min: number, max: number): boolean {
	if (value === undefined || value === "") return false;
	const number = Number(value);
	return Number.isInteger(number) && number >= min && number <= max;
}

/**
 * Plain-language summary of an expression.
 *
 * Covers the shapes the form's presets produce and degrades to echoing the
 * expression for anything more complex, rather than guessing wrong.
 */
export function describeCron(expression: string): string {
	const parts = splitCron(expression);
	if (!parts) return expression;
	const { minute, hour, dayOfMonth, month, dayOfWeek } = parts;

	const everyField = (field: string) => field === "*";
	const time = () => `${pad(hour)}:${pad(minute)}`;
	const numeric = (field: string) => /^\d+$/.test(field);

	if (minute.startsWith("*/") && everyField(hour) && everyField(dayOfMonth) && everyField(month) && everyField(dayOfWeek)) {
		return `Every ${minute.slice(2)} minutes`;
	}
	if (numeric(minute) && everyField(hour) && everyField(dayOfMonth) && everyField(month) && everyField(dayOfWeek)) {
		return `Hourly at :${pad(minute)}`;
	}
	if (numeric(minute) && numeric(hour) && everyField(dayOfMonth) && everyField(month)) {
		if (everyField(dayOfWeek)) return `Daily at ${time()}`;
		if (dayOfWeek === "1-5") return `Weekdays at ${time()}`;
		if (numeric(dayOfWeek)) return `Every ${WEEKDAYS[Number(dayOfWeek)] ?? dayOfWeek} at ${time()}`;
	}
	if (numeric(minute) && numeric(hour) && numeric(dayOfMonth) && everyField(month) && everyField(dayOfWeek)) {
		return `Monthly on day ${dayOfMonth} at ${time()}`;
	}
	return expression;
}

function pad(field: string): string {
	return /^\d+$/.test(field) ? field.padStart(2, "0") : field;
}

/**
 * Presets for the form.
 *
 * Minutes avoid :00 deliberately: a default that everyone accepts makes every
 * install fire at the same instant.
 */
export const CRON_PRESETS: Array<{ label: string; expression: string }> = [
	{ label: "Every morning", expression: "7 9 * * *" },
	{ label: "Weekday mornings", expression: "7 9 * * 1-5" },
	{ label: "Hourly", expression: "13 * * * *" },
	{ label: "Every 15 minutes", expression: "*/15 * * * *" },
	{ label: "Weekly (Monday)", expression: "7 9 * * 1" },
];

/** Local-time ISO string for a datetime-local input value. */
export function toRunAtIso(value: string): string | undefined {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}
