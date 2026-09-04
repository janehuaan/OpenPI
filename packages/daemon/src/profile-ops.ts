/**
 * Profile, capabilities, and document text extraction.
 *
 * All three lived in the old Electron `bridge.mjs`. Capabilities in particular
 * needed four custom pi RPC commands there (`get_capabilities`,
 * `reload_resources`, `install_package`, `remove_package`) that only existed
 * because the fork patched them in — upstream 0.84.4 has none of them. What it
 * does have is `settings.json` as the source of truth plus `pi install`/`remove`,
 * which is what this uses.
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Capabilities, CapabilityEntry, DocumentText, UserProfile } from "@openpi/shared";
import { agentDir, piCli } from "./config.ts";

const execFileAsync = promisify(execFile);

// ── Profile ───────────────────────────────────────────────────────────────

function profilePath(): string {
	return join(agentDir(), "user.json");
}

export function getProfile(): UserProfile {
	const file = profilePath();
	if (!existsSync(file)) return {};
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as UserProfile;
		return { nickname: parsed.nickname, avatarEmoji: parsed.avatarEmoji, updatedAt: parsed.updatedAt };
	} catch {
		return {};
	}
}

/**
 * Save the profile, clamping both fields.
 *
 * The nickname reaches a prompt and the emoji reaches a label, so neither is
 * allowed to be unbounded — a 10 KB "nickname" would otherwise be pasted into
 * every turn.
 */
export function saveProfile(profile: UserProfile): UserProfile {
	const next: UserProfile = {
		nickname: typeof profile.nickname === "string" ? profile.nickname.trim().slice(0, 40) || undefined : undefined,
		avatarEmoji:
			typeof profile.avatarEmoji === "string" ? [...profile.avatarEmoji.trim()].slice(0, 2).join("") || undefined : undefined,
		updatedAt: new Date().toISOString(),
	};
	const file = profilePath();
	mkdirSync(agentDir(), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	renameSync(temporary, file);
	return next;
}

// ── Capabilities ──────────────────────────────────────────────────────────

interface SettingsFile {
	extensions?: string[];
	skills?: string[];
	prompts?: string[];
	packages?: Array<string | { source?: string }>;
}

function settingsPath(): string {
	return join(agentDir(), "settings.json");
}

function readSettings(): SettingsFile {
	const file = settingsPath();
	if (!existsSync(file)) return {};
	try {
		return JSON.parse(readFileSync(file, "utf8")) as SettingsFile;
	} catch {
		// A corrupt settings file must not make the capabilities view unreachable;
		// it is also what `pi install` would rewrite anyway.
		return {};
	}
}

function writeSettings(settings: SettingsFile): void {
	const file = settingsPath();
	mkdirSync(agentDir(), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
	renameSync(temporary, file);
}

/** Resolve a settings path the way pi does: relative to the agent dir. */
function resolveEntry(path: string): string {
	return isAbsolute(path) ? path : resolve(agentDir(), path);
}

export function capabilities(): Capabilities {
	const settings = readSettings();
	const entries: CapabilityEntry[] = [];

	const addLocal = (kind: CapabilityEntry["kind"], paths: string[] | undefined) => {
		for (const path of paths ?? []) {
			// Glob and exclusion syntax is pi's to interpret; showing the pattern
			// verbatim is honest, and marking it absent would be wrong.
			const isPattern = /[*!]/.test(path) || path.startsWith("+") || path.startsWith("-");
			const resolved = isPattern ? undefined : resolveEntry(path);
			entries.push({
				source: path,
				resolved,
				kind,
				present: isPattern ? true : existsSync(resolved!),
			});
		}
	};

	addLocal("extension", settings.extensions);
	addLocal("skill", settings.skills);
	addLocal("prompt", settings.prompts);

	for (const entry of settings.packages ?? []) {
		const source = typeof entry === "string" ? entry : (entry.source ?? "");
		if (!source) continue;
		// A package source can be an npm spec, a git URL, or a path; only a path can
		// be checked for existence.
		const looksLikePath = source.startsWith(".") || source.startsWith("/");
		const resolved = looksLikePath ? resolveEntry(source) : undefined;
		entries.push({
			source,
			resolved,
			kind: "package",
			present: looksLikePath ? existsSync(resolved!) : true,
		});
	}

	return { agentDir: agentDir(), entries };
}

/**
 * Add a local extension path to settings.
 *
 * Written directly rather than through `pi install`, which treats a bare path as
 * a package and rewrites it relative to the agent dir. For a local file the
 * `extensions` array is the documented field.
 */
export function addExtension(path: string): Capabilities {
	const absolute = resolveEntry(path);
	if (!existsSync(absolute)) throw new Error(`No such extension: ${absolute}`);
	const settings = readSettings();
	const list = settings.extensions ?? [];
	if (!list.includes(absolute)) list.push(absolute);
	writeSettings({ ...settings, extensions: list });
	return capabilities();
}

export function removeExtension(path: string): Capabilities {
	const settings = readSettings();
	const absolute = resolveEntry(path);
	const list = (settings.extensions ?? []).filter((entry) => entry !== path && resolveEntry(entry) !== absolute);
	writeSettings({ ...settings, extensions: list });
	return capabilities();
}

/** Install an npm or git package through the pi CLI, which owns that format. */
export async function installPackage(source: string): Promise<Capabilities> {
	await runPi(["install", source]);
	return capabilities();
}

export async function removePackage(source: string): Promise<Capabilities> {
	await runPi(["remove", source]);
	return capabilities();
}

async function runPi(args: string[]): Promise<string> {
	const { stdout, stderr } = await execFileAsync(process.execPath, [piCli(), ...args], {
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir() },
		timeout: 120_000,
		maxBuffer: 4 * 1024 * 1024,
	});
	return stdout || stderr;
}

// ── Documents ─────────────────────────────────────────────────────────────

/**
 * Cap on extracted text.
 *
 * The text is pasted into a prompt, so an unbounded document would blow the
 * context window and cost a compaction on the first turn.
 */
const MAX_DOCUMENT_CHARS = 60_000;

/** Extensions handled without any dependency. */
const PLAIN_TEXT = new Set([
	"txt",
	"md",
	"markdown",
	"json",
	"jsonl",
	"yaml",
	"yml",
	"csv",
	"tsv",
	"log",
	"ts",
	"tsx",
	"js",
	"jsx",
	"py",
	"rs",
	"go",
	"java",
	"sh",
	"toml",
	"ini",
	"html",
	"css",
	"xml",
	"sql",
]);

function extensionOf(fileName: string): string {
	const index = fileName.lastIndexOf(".");
	return index >= 0 ? fileName.slice(index + 1).toLowerCase() : "";
}

/**
 * Extract text from an attached document.
 *
 * Plain text and `.docx` are handled here; `.docx` is a zip of XML, and pulling
 * `word/document.xml` out of it is enough for prose. The old version depended on
 * `mammoth` and `pdf-parse` — the first for exactly this, the second is why PDF
 * is unsupported here rather than badly supported: a real PDF text layer needs a
 * font-aware parser, and a wrong extraction silently feeds the model garbage.
 */
export function extractDocument(fileName: string, dataBase64: string): DocumentText {
	const extension = extensionOf(fileName);
	const buffer = Buffer.from(dataBase64, "base64");

	if (extension === "docx") return limit(fileName, extractDocx(buffer));
	if (extension === "pdf") {
		throw new Error("PDF attachments are not supported; export to text or Markdown first.");
	}
	if (PLAIN_TEXT.has(extension) || looksLikeText(buffer)) return limit(fileName, buffer.toString("utf8"));

	throw new Error(`Cannot read ${fileName}: unsupported or binary file.`);
}

function limit(name: string, text: string): DocumentText {
	const trimmed = text.replace(/\r\n/g, "\n").trim();
	if (trimmed.length <= MAX_DOCUMENT_CHARS) return { name, text: trimmed, truncated: false };
	return { name, text: `${trimmed.slice(0, MAX_DOCUMENT_CHARS)}\n…[truncated]`, truncated: true };
}

/** A NUL byte in the first few KB means binary, not text in an unknown encoding. */
function looksLikeText(buffer: Buffer): boolean {
	const head = buffer.subarray(0, 4096);
	return !head.includes(0);
}

/**
 * Pull the text out of a .docx without a dependency.
 *
 * A .docx is a zip; `word/document.xml` holds the body. Rather than implement
 * inflate, this shells out to the `unzip` present on macOS and Linux, then strips
 * tags — paragraph and break elements become newlines so the prose keeps its
 * shape.
 */
function extractDocx(buffer: Buffer): string {
	const dir = mkdtempSync(join(tmpdir(), "openpi-docx-"));
	try {
		const file = join(dir, "input.docx");
		writeFileSync(file, buffer);
		const xml = execFileSync("unzip", ["-p", file, "word/document.xml"], {
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
		});
		return xml
			.replace(/<w:p[ >]/g, "\n<w:p ")
			.replace(/<w:br\s*\/>/g, "\n")
			.replace(/<w:tab\s*\/>/g, "\t")
			.replace(/<[^>]+>/g, "")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/\n{3,}/g, "\n\n");
	} catch (error) {
		throw new Error(`Could not read .docx: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
