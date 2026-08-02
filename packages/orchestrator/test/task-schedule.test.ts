import { describe, expect, it } from "vitest";
import { nextRunForSchedule } from "../src/task-schedule.ts";

describe("task-schedule", () => {
	it("returns once timestamps as ISO", () => {
		const next = nextRunForSchedule(
			{ kind: "once", runAt: "2026-07-20T09:00:00.000Z" },
			new Date("2026-07-01T00:00:00.000Z"),
		);
		expect(next).toBe("2026-07-20T09:00:00.000Z");
	});

	it("finds the next UTC cron minute", () => {
		const after = new Date("2026-07-20T08:59:10.000Z");
		const next = nextRunForSchedule({ kind: "cron", expression: "0 9 * * *" }, after);
		expect(next).toBe("2026-07-20T09:00:00.000Z");
	});

	it("accepts IANA timezones", () => {
		const after = new Date("2026-07-20T00:00:00.000Z");
		const next = nextRunForSchedule({ kind: "cron", expression: "0 9 * * *", timezone: "America/New_York" }, after);
		// 09:00 America/New_York in July is UTC 13:00 (EDT).
		expect(next).toBe("2026-07-20T13:00:00.000Z");
	});

	it("rejects invalid timezones", () => {
		expect(() =>
			nextRunForSchedule(
				{ kind: "cron", expression: "0 9 * * *", timezone: "Not/AZone" },
				new Date("2026-07-20T00:00:00.000Z"),
			),
		).toThrow(/Invalid IANA timezone/);
	});
});
