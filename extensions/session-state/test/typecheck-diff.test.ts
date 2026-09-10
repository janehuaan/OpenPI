import { describe, it, expect } from "vitest";
import { parseTscLine, diffTypeErrors, type TypecheckError } from "../src/typecheck-diff.ts";

describe("Typecheck Diffing Gate", () => {
	it("parses tsc single line diagnostics accurately", () => {
		const line = "src/index.ts(42,15): error TS2322: Type 'string' is not assignable to type 'number'.";
		const parsed = parseTscLine(line);
		expect(parsed).not.toBeNull();
		expect(parsed?.file).toBe("src/index.ts");
		expect(parsed?.line).toBe(42);
		expect(parsed?.col).toBe(15);
		expect(parsed?.code).toBe("TS2322");
		expect(parsed?.message).toBe("Type 'string' is not assignable to type 'number'.");
	});

	it("diffs and filters out baseline pre-existing errors", () => {
		const preExisting: TypecheckError = {
			file: "src/legacy.ts",
			line: 10,
			col: 2,
			code: "TS2304",
			message: "Cannot find name 'oldVar'.",
			raw: "src/legacy.ts(10,2): error TS2304: Cannot find name 'oldVar'.",
		};

		const newError: TypecheckError = {
			file: "src/user.ts",
			line: 25,
			col: 5,
			code: "TS2339",
			message: "Property 'age' does not exist on type 'User'.",
			raw: "src/user.ts(25,5): error TS2339: Property 'age' does not exist on type 'User'.",
		};

		const before = [preExisting];
		const after = [preExisting, newError];

		const delta = diffTypeErrors(before, after, "src/user.ts");
		expect(delta.length).toBe(1);
		expect(delta[0].code).toBe("TS2339");
		expect(delta[0].file).toBe("src/user.ts");
	});

	it("returns empty when no new errors were introduced", () => {
		const pre = [{ file: "a.ts", line: 1, col: 1, code: "TS1005", message: "err", raw: "" }];
		const delta = diffTypeErrors(pre, pre, "b.ts");
		expect(delta.length).toBe(0);
	});
});
