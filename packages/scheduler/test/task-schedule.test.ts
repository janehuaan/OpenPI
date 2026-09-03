/**
 * task-schedule.ts coverage: cron field parsing and the timezone path.
 *
 * A scheduler that computes the wrong next-run time is worse than one that
 * fails: the job silently never fires, or fires at 3am. The old suite had four
 * cases and covered no cron syntax beyond `0 9 * * *`.
 */

import { describe, expect, it } from "vitest";
import { nextRunForSchedule } from "../src/task-schedule.ts";

const at = (iso: string) => new Date(iso);

describe("once schedules", () => {
	it("returns the timestamp as ISO", () => {
		expect(nextRunForSchedule({ kind: "once", runAt: "2026-07-20T09:00:00.000Z" }, at("2026-07-01T00:00:00Z"))).toBe(
			"2026-07-20T09:00:00.000Z",
		);
	});

	it("normalizes a non-ISO but parseable timestamp", () => {
		expect(nextRunForSchedule({ kind: "once", runAt: "2026-07-20T09:00:00Z" }, at("2026-07-01T00:00:00Z"))).toBe(
			"2026-07-20T09:00:00.000Z",
		);
	});

	it("returns a past timestamp unchanged, leaving the catch-up decision to the caller", () => {
		expect(nextRunForSchedule({ kind: "once", runAt: "2020-01-01T00:00:00.000Z" }, at("2026-07-01T00:00:00Z"))).toBe(
			"2020-01-01T00:00:00.000Z",
		);
	});

	it("rejects an unparseable timestamp", () => {
		expect(() => nextRunForSchedule({ kind: "once", runAt: "not a date" }, at("2026-07-01T00:00:00Z"))).toThrow(
			/Invalid runAt/,
		);
	});
});

describe("cron field syntax", () => {
	const next = (expression: string, after: string) =>
		nextRunForSchedule({ kind: "cron", expression }, at(after));

	it("finds the next matching minute", () => {
		expect(next("0 9 * * *", "2026-07-20T08:59:10Z")).toBe("2026-07-20T09:00:00.000Z");
	});

	it("never returns the current minute, so a tick cannot re-fire the same slot", () => {
		expect(next("0 9 * * *", "2026-07-20T09:00:00Z")).toBe("2026-07-21T09:00:00.000Z");
	});

	it("handles a step expression", () => {
		expect(next("*/15 * * * *", "2026-07-20T10:01:00Z")).toBe("2026-07-20T10:15:00.000Z");
	});

	it("handles a comma list", () => {
		expect(next("0,30 * * * *", "2026-07-20T10:05:00Z")).toBe("2026-07-20T10:30:00.000Z");
	});

	it("handles a range", () => {
		expect(next("0 9-17 * * *", "2026-07-20T08:00:00Z")).toBe("2026-07-20T09:00:00.000Z");
		expect(next("0 9-17 * * *", "2026-07-20T09:30:00Z")).toBe("2026-07-20T10:00:00.000Z");
	});

	it("handles day-of-week", () => {
		// 2026-07-20 is a Monday; asking for Friday (5) must skip to the 24th.
		expect(next("0 9 * * 5", "2026-07-20T00:00:00Z")).toBe("2026-07-24T09:00:00.000Z");
	});

	it("handles day-of-month", () => {
		expect(next("0 0 1 * *", "2026-07-20T00:00:00Z")).toBe("2026-08-01T00:00:00.000Z");
	});

	it("handles a specific month", () => {
		expect(next("0 0 1 1 *", "2026-07-20T00:00:00Z")).toBe("2027-01-01T00:00:00.000Z");
	});

	it("crosses a month boundary", () => {
		expect(next("0 0 * * *", "2026-07-31T12:00:00Z")).toBe("2026-08-01T00:00:00.000Z");
	});

	it("crosses a year boundary", () => {
		expect(next("0 0 * * *", "2026-12-31T12:00:00Z")).toBe("2027-01-01T00:00:00.000Z");
	});

	it("finds February 29 when it falls inside the one-year search window", () => {
		expect(next("0 0 29 2 *", "2028-01-01T00:00:00Z")).toBe("2028-02-29T00:00:00.000Z");
	});

	it("gives up on February 29 when the next leap day is more than a year out", () => {
		// The search window is 366 days, so from mid-2026 it cannot reach Feb 2028.
		// A leap-day cron therefore needs re-computing closer to the date; the
		// scheduler surfaces the throw rather than silently never firing.
		expect(() => next("0 0 29 2 *", "2026-07-20T00:00:00Z")).toThrow(/no matching time/);
	});

	it("rejects an expression without five fields", () => {
		expect(() => next("0 9 * *", "2026-07-20T00:00:00Z")).toThrow(/five fields/);
		expect(() => next("0 9 * * * *", "2026-07-20T00:00:00Z")).toThrow(/five fields/);
	});

	it("rejects out-of-range and non-numeric fields", () => {
		expect(() => next("99 9 * * *", "2026-07-20T00:00:00Z")).toThrow(/Invalid minute/);
		expect(() => next("0 99 * * *", "2026-07-20T00:00:00Z")).toThrow(/Invalid hour/);
		expect(() => next("abc 9 * * *", "2026-07-20T00:00:00Z")).toThrow(/Invalid minute/);
	});

	it("rejects an expression with no match within a year", () => {
		// Feb 30 never occurs.
		expect(() => next("0 0 30 2 *", "2026-07-20T00:00:00Z")).toThrow(/no matching time/);
	});

	it("tolerates extra whitespace between fields", () => {
		expect(next("0   9  *  *  *", "2026-07-20T08:00:00Z")).toBe("2026-07-20T09:00:00.000Z");
	});
});

describe("timezones", () => {
	const next = (expression: string, timezone: string, after: string) =>
		nextRunForSchedule({ kind: "cron", expression, timezone }, at(after));

	it("interprets the expression in the given zone during DST", () => {
		// 09:00 New York in July is EDT = 13:00 UTC.
		expect(next("0 9 * * *", "America/New_York", "2026-07-20T00:00:00Z")).toBe("2026-07-20T13:00:00.000Z");
	});

	it("interprets the same expression differently outside DST", () => {
		// 09:00 New York in January is EST = 14:00 UTC.
		expect(next("0 9 * * *", "America/New_York", "2026-01-20T00:00:00Z")).toBe("2026-01-20T14:00:00.000Z");
	});

	it("handles a zone ahead of UTC", () => {
		// 09:00 Shanghai = 01:00 UTC, so a run "today" is already past at 02:00 UTC.
		expect(next("0 9 * * *", "Asia/Shanghai", "2026-07-20T02:00:00Z")).toBe("2026-07-21T01:00:00.000Z");
	});

	it("handles a half-hour offset zone", () => {
		// 09:00 Kolkata = 03:30 UTC year-round.
		expect(next("0 9 * * *", "Asia/Kolkata", "2026-07-20T00:00:00Z")).toBe("2026-07-20T03:30:00.000Z");
	});

	it("treats an explicit UTC timezone as the UTC path", () => {
		expect(next("0 9 * * *", "UTC", "2026-07-20T08:00:00Z")).toBe("2026-07-20T09:00:00.000Z");
	});

	it("resolves weekday in the target zone, not UTC", () => {
		// 2026-07-19T16:00Z is already Monday 00:00 in Shanghai while still Sunday
		// in UTC, so a Monday-only cron must match that same Shanghai day.
		expect(next("0 1 * * 1", "Asia/Shanghai", "2026-07-19T16:00:00Z")).toBe("2026-07-19T17:00:00.000Z");
	});

	it("skips to the following week once the zone's weekday slot has passed", () => {
		// Two hours later it is Monday 02:00 Shanghai; 01:00 is gone.
		expect(next("0 1 * * 1", "Asia/Shanghai", "2026-07-19T18:00:00Z")).toBe("2026-07-26T17:00:00.000Z");
	});

	it("rejects an invalid zone", () => {
		expect(() => next("0 9 * * *", "Not/AZone", "2026-07-20T00:00:00Z")).toThrow(/Invalid IANA timezone/);
	});
});
