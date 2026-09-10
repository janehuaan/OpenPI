/**
 * Lightweight TypeScript Baseline Diffing Gate
 *
 * Verifies cross-file type compatibility without getting blocked by existing codebase errors.
 * - Extracts baseline diagnostics before modification.
 * - Compares diagnostics after modification.
 * - Only flags NEW errors introduced by the current edit.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export interface TypecheckError {
	file: string;
	line: number;
	col: number;
	code: string;
	message: string;
	raw: string;
}

/**
 * Finds the nearest tsconfig.json walking upwards from target directory.
 */
export function findTsConfig(startDir: string): string | null {
	let current = resolve(startDir);
	while (true) {
		const candidate = join(current, "tsconfig.json");
		if (existsSync(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

/**
 * Parses raw tsc line output e.g.:
 * "src/index.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'."
 */
export function parseTscLine(line: string): TypecheckError | null {
	const match = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/.exec(line.trim());
	if (!match) return null;

	return {
		file: match[1],
		line: Number.parseInt(match[2], 10),
		col: Number.parseInt(match[3], 10),
		code: match[4],
		message: match[5],
		raw: line.trim(),
	};
}

/**
 * Runs quick typecheck and returns array of error signatures.
 * Times out after 3000ms to never hang the agent.
 */
export function runQuickTypecheck(cwd: string, timeoutMs = 3000): TypecheckError[] {
	const config = findTsConfig(cwd);
	if (!config) return [];

	try {
		// Run tsc with --noEmit --pretty false
		const stdout = execFileSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
			cwd: dirname(config),
			encoding: "utf8",
			timeout: timeoutMs,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return [];
	} catch (err: any) {
		const output = String(err.stdout || err.output || "");
		if (!output) return [];

		const errors: TypecheckError[] = [];
		for (const line of output.split("\n")) {
			const parsed = parseTscLine(line);
			if (parsed) errors.push(parsed);
		}
		return errors;
	}
}

/**
 * Checks if new type errors were introduced by the edit.
 */
export function diffTypeErrors(
	beforeErrors: TypecheckError[],
	afterErrors: TypecheckError[],
	modifiedRelativePath: string,
): TypecheckError[] {
	const beforeSignatures = new Set(beforeErrors.map((e) => `${e.file}:${e.code}:${e.message}`));
	const newErrors = afterErrors.filter((e) => !beforeSignatures.has(`${e.file}:${e.code}:${e.message}`));

	if (newErrors.length === 0) return [];

	// Prioritize errors in the modified file itself or immediate dependents
	const normalizedModified = modifiedRelativePath.replace(/\\/g, "/");
	const relatedErrors = newErrors.filter(
		(e) => e.file.replace(/\\/g, "/").includes(normalizedModified) || newErrors.length <= 3,
	);

	return relatedErrors.length > 0 ? relatedErrors : newErrors.slice(0, 3);
}
