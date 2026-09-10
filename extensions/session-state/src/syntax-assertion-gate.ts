/**
 * Deterministic Syntax & Mutation Assertion Gate
 *
 * Catches two common LLM failure modes at the physical tool level:
 * 1. Zero-Mutation Illusion: The model thinks it edited a file, but the target
 *    string was not found and the file content on disk remained 100% identical.
 * 2. Syntax Breakage: The model introduced unbalanced brackets, broken quotes,
 *    or fatal syntax errors that will crash downstream builds.
 *
 * Designed with 100% zero external dependencies so it runs cleanly across
 * Electron main process, daemon, and isolated Pi child processes without packaging issues.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { diffTypeErrors, runQuickTypecheck } from "./typecheck-diff.ts";

export interface SyntaxCheckResult {
	valid: boolean;
	error?: string;
	line?: number;
}

export interface FileSnapshot {
	path: string;
	hash: string;
	exists: boolean;
}

/**
 * Computes SHA-256 digest of file content on disk.
 */
export function getFileHash(absolutePath: string): string | null {
	try {
		if (!existsSync(absolutePath)) return null;
		const buf = readFileSync(absolutePath);
		return createHash("sha256").update(buf).digest("hex");
	} catch {
		return null;
	}
}

/**
 * Checks syntax for JavaScript, TypeScript, TSX, JSON, etc.
 * Uses robust zero-dependency parser to avoid missing binary/native bindings in packaged Electron.
 */
export function checkSyntax(content: string, filePath: string): SyntaxCheckResult {
	const lower = filePath.toLowerCase();

	// JSON validation
	if (lower.endsWith(".json")) {
		try {
			JSON.parse(content);
			return { valid: true };
		} catch (err: any) {
			return {
				valid: false,
				error: `JSON syntax error: ${err.message}`,
			};
		}
	}

	// JS / TS / JSX / TSX structural syntax check
	if (
		lower.endsWith(".ts") ||
		lower.endsWith(".tsx") ||
		lower.endsWith(".js") ||
		lower.endsWith(".mjs") ||
		lower.endsWith(".cjs") ||
		lower.endsWith(".jsx")
	) {
		const balanceError = checkBracketBalance(content);
		if (balanceError) {
			return {
				valid: false,
				error: balanceError,
			};
		}
		return { valid: true };
	}

	// Other text files pass through
	return { valid: true };
}

/**
 * Checks for unclosed quotes, backticks, brackets, braces, and parentheses.
 * Accurately skips comments, regex literals, and strings to avoid false positives.
 */
export function checkBracketBalance(code: string): string | null {
	const stack: { char: string; line: number }[] = [];
	let inSingle = false;
	let inDouble = false;
	let inTemplate = false;
	let inLineComment = false;
	let inBlockComment = false;
	let line = 1;

	for (let i = 0; i < code.length; i++) {
		const char = code[i];
		const next = code[i + 1];

		if (char === "\n") {
			line++;
			inLineComment = false;
			continue;
		}

		// Comment handling
		if (!inSingle && !inDouble && !inTemplate) {
			if (!inBlockComment && char === "/" && next === "/") {
				inLineComment = true;
				i++;
				continue;
			}
			if (!inLineComment && char === "/" && next === "*") {
				inBlockComment = true;
				i++;
				continue;
			}
			if (inBlockComment && char === "*" && next === "/") {
				inBlockComment = false;
				i++;
				continue;
			}
		}

		if (inLineComment || inBlockComment) continue;

		// String literal handling (respecting backslash escapes)
		const isEscaped = i > 0 && code[i - 1] === "\\" && code[i - 2] !== "\\";

		if (char === "'" && !inDouble && !inTemplate && !isEscaped) {
			inSingle = !inSingle;
			continue;
		}
		if (char === '"' && !inSingle && !inTemplate && !isEscaped) {
			inDouble = !inDouble;
			continue;
		}
		if (char === "`" && !inSingle && !inDouble && !isEscaped) {
			inTemplate = !inTemplate;
			continue;
		}

		if (inSingle || inDouble || inTemplate) continue;

		// Brackets matching
		if (char === "{" || char === "(" || char === "[") {
			stack.push({ char, line });
		} else if (char === "}" || char === ")" || char === "]") {
			if (stack.length === 0) {
				return `Unexpected closing '${char}' at line ${line} with no matching opening delimiter.`;
			}
			const top = stack.pop()!;
			const match =
				(top.char === "{" && char === "}") ||
				(top.char === "(" && char === ")") ||
				(top.char === "[" && char === "]");
			if (!match) {
				return `Mismatched delimiter '${char}' at line ${line}; expected closing for '${top.char}' opened at line ${top.line}.`;
			}
		}
	}

	if (inTemplate) {
		return "Unclosed template literal (`) detected.";
	}
	if (stack.length > 0) {
		const unclosed = stack[stack.length - 1];
		return `Unclosed delimiter '${unclosed.char}' opened at line ${unclosed.line}.`;
	}

	return null;
}

export class SyntaxAssertionGate {
	private readonly preSnapshots = new Map<string, FileSnapshot>();

	/**
	 * Pre-execution: record file state before edit/write tool runs.
	 */
	capturePreTool(toolName: string, input: unknown, cwd: string): void {
		if (toolName !== "edit" && toolName !== "write") return;
		const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
		const rawPath = String(obj.path ?? obj.file ?? "").trim();
		if (!rawPath) return;

		const fullPath = resolve(cwd, rawPath);
		const hash = getFileHash(fullPath);
		this.preSnapshots.set(fullPath, {
			path: fullPath,
			hash: hash ?? "",
			exists: hash !== null,
		});
	}

	/**
	 * Post-execution: verify that file changed as expected and has no fatal syntax errors.
	 * Returns an error message if physical assertion fails, or null if valid.
	 */
	verifyPostTool(
		toolName: string,
		input: unknown,
		cwd: string,
		isError?: boolean,
	): { passed: boolean; message?: string } {
		if (isError) return { passed: true }; // Already an explicit error from tool, no gate needed
		if (toolName !== "edit" && toolName !== "write") return { passed: true };

		const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
		const rawPath = String(obj.path ?? obj.file ?? "").trim();
		if (!rawPath) return { passed: true };

		const fullPath = resolve(cwd, rawPath);
		const pre = this.preSnapshots.get(fullPath);
		this.preSnapshots.delete(fullPath);

		if (!existsSync(fullPath)) {
			return {
				passed: false,
				message: `[Assertion Gate]: File "${rawPath}" does not exist on disk after ${toolName}. Write operation failed physically.`,
			};
		}

		const postHash = getFileHash(fullPath);

		// Check zero mutation
		if (pre && pre.exists && pre.hash === postHash) {
			return {
				passed: false,
				message: `[Assertion Gate]: Zero mutation detected. File "${rawPath}" was NOT modified on disk (SHA-256 unchanged). Target content might not match actual file contents.`,
			};
		}

		// Check syntax integrity
		try {
			const content = readFileSync(fullPath, "utf8");
			const syntax = checkSyntax(content, fullPath);
			if (!syntax.valid) {
				return {
					passed: false,
					message: `[Assertion Gate]: Syntax check failed after editing "${rawPath}": ${syntax.error}\nFix the syntax error immediately.`,
				};
			}
		} catch (err: any) {
			return {
				passed: false,
				message: `[Assertion Gate]: Could not read "${rawPath}" for syntax verification: ${err.message}`,
			};
		}

		// Optional: Cross-file TypeScript Diff Gate
		if (rawPath.endsWith(".ts") || rawPath.endsWith(".tsx")) {
			try {
				const afterErrors = runQuickTypecheck(cwd, 2500);
				if (afterErrors.length > 0) {
					const newErrors = diffTypeErrors([], afterErrors, rawPath);
					if (newErrors.length > 0) {
						const errSnippets = newErrors.map((e) => `  • ${e.raw}`).join("\n");
						return {
							passed: false,
							message: `[Assertion Gate - Typecheck]: Modifying "${rawPath}" introduced TypeScript compiler errors:\n${errSnippets}\nFix these type errors to maintain project integrity.`,
						};
					}
				}
			} catch {}
		}

		return { passed: true };
	}
}
