/**
 * cron.ts coverage: validation and the description used in the task form.
 *
 * Validating in the renderer is what keeps a bad expression from reaching the
 * daemon, where the scheduler throws and the UI sees an opaque IPC error. These
 * cases mirror the scheduler's own field rules.
 */

import { describe, expect, it } from "vitest";
import { CRON_PRESETS, describeCron, splitCron, toRunAtIso, validateCron } from "../lib/cron.ts";

describe("splitCron", () => {
	it("splits five fields", () => {
		expect(splitCron("7 9 * * 1-5")).toEqual({
			minute: "7",
			hour: "9",
			dayOfMonth: "*",
			month: "*",
			dayOfWeek: "1-5",
		});
	});

	it("tolerates extra whitespace", () => {
		expect(splitCron("  7   9  *  *  * ")?.hour).toBe("9");
	});

	it("returns undefined for the wrong field count", () => {
		expect(splitCron("7 9 * *")).toBeUndefined();
		expect(splitCron("7 9 * * * *")).toBeUndefined();
		expect(splitCron("")).toBeUndefined();
	});
});

describe("validateCron", () => {
	it("accepts the shapes the presets produce", () => {
		for (const preset of CRON_PRESETS) {
			expect(validateCron(preset.expression), preset.label).toBeUndefined();
		}
	});

	it("accepts stars, steps, lists and ranges", () => {
		for (const expression of ["* * * * *", "*/15 * * * *", "0,30 * * * *", "0 9-17 * * *", "0 0 1 1 0"]) {
			expect(validateCron(expression), expression).toBeUndefined();
		}
	});

	it("rejects the wrong field count with a helpful message", () => {
		expect(validateCron("7 9 * *")).toMatch(/five fields/);
	});

	it("names the offending field", () => {
		expect(validateCron("99 9 * * *")).toMatch(/minute/);
		expect(validateCron("0 99 * * *")).toMatch(/hour/);
		expect(validateCron("0 0 99 * *")).toMatch(/day of month/);
		expect(validateCron("0 0 * 99 *")).toMatch(/month/);
		expect(validateCron("0 0 * * 9")).toMatch(/day of week/);
	});

	it("rejects non-numeric and empty fields", () => {
		expect(validateCron("abc 9 * * *")).toMatch(/minute/);
		expect(validateCron("0 9 * * 1-")).toMatch(/day of week/);
		expect(validateCron("0 9 * * ,")).toMatch(/day of week/);
	});

	it("rejects day-of-month 0, which is out of range unlike day-of-week 0", () => {
		expect(validateCron("0 0 0 * *")).toMatch(/day of month/);
		expect(validateCron("0 0 * * 0")).toBeUndefined();
	});

	it("rejects a zero or oversized step", () => {
		expect(validateCron("*/0 * * * *")).toMatch(/minute/);
		expect(validateCron("*/99 * * * *")).toMatch(/minute/);
	});
});

describe("describeCron", () => {
	it("describes the preset shapes in plain language", () => {
		expect(describeCron("7 9 * * *")).toBe("Daily at 09:07");
		expect(describeCron("7 9 * * 1-5")).toBe("Weekdays at 09:07");
		expect(describeCron("13 * * * *")).toBe("Hourly at :13");
		expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
		expect(describeCron("7 9 * * 1")).toBe("Every Mon at 09:07");
	});

	it("describes a monthly schedule", () => {
		expect(describeCron("0 0 1 * *")).toBe("Monthly on day 1 at 00:00");
	});

	it("pads single-digit times", () => {
		expect(describeCron("5 8 * * *")).toBe("Daily at 08:05");
	});

	it("echoes anything it cannot summarize rather than guessing", () => {
		expect(describeCron("0 9-17 * * 1-5")).toBe("0 9-17 * * 1-5");
		expect(describeCron("not a cron")).toBe("not a cron");
	});
});

describe("presets", () => {
	it("avoids minute 0, so installs do not all fire on the same instant", () => {
		for (const preset of CRON_PRESETS) {
			const minute = preset.expression.split(" ")[0]!;
			expect(minute, preset.label).not.toBe("0");
		}
	});
});

describe("toRunAtIso", () => {
	it("converts a datetime-local value to ISO", () => {
		expect(toRunAtIso("2026-09-05T09:07")).toBe(new Date("2026-09-05T09:07").toISOString());
	});

	it("returns undefined for unparseable input", () => {
		expect(toRunAtIso("")).toBeUndefined();
		expect(toRunAtIso("not a date")).toBeUndefined();
	});
});
