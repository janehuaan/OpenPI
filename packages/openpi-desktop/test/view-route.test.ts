import { describe, expect, it } from "vitest";
import { hashForView, initialView, isView, viewFromHash } from "../web/lib/view-route.ts";

describe("desktop view routes", () => {
	it("maps every supported page to a stable hash route", () => {
		for (const view of ["chat", "tasks", "capabilities", "memory", "intelligence", "daemon"] as const) {
			expect(viewFromHash(hashForView(view))).toBe(view);
		}
	});

	it("restores a routed page before the app renders", () => {
		expect(initialView("#/memory", "chat")).toBe("memory");
	});

	it("restores the persisted page when Electron starts without a hash", () => {
		expect(initialView("", "memory")).toBe("memory");
	});

	it("guards unknown routes and persisted values", () => {
		expect(viewFromHash("#/unknown")).toBeUndefined();
		expect(initialView("#/unknown", "memory")).toBe("chat");
		expect(initialView("", "unknown")).toBe("chat");
		expect(isView("unknown")).toBe(false);
	});
});
