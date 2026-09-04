/**
 * profile-ops coverage.
 *
 * Profile clamping and document extraction both feed a prompt, so their limits
 * are correctness properties rather than polish: an unbounded nickname or
 * document is pasted into every turn and forces an immediate compaction.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import {
	addExtension,
	capabilities,
	extractDocument,
	getProfile,
	removeExtension,
	saveProfile,
} from "../src/profile-ops.ts";

let root: string;
let previous: string | undefined;

beforeEach(() => {
	previous = process.env.OPENPI_DIR;
	root = mkdtempSync(join(tmpdir(), "openpi-profile-"));
	process.env.OPENPI_DIR = root;
});

afterEach(() => {
	if (previous === undefined) delete process.env.OPENPI_DIR;
	else process.env.OPENPI_DIR = previous;
	rmSync(root, { recursive: true, force: true });
});

const agent = () => join(root, "agent");
const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

test("getProfile returns empty before anything is saved", () => {
	assert.deepEqual(getProfile(), {});
});

test("saveProfile round-trips through user.json", () => {
	saveProfile({ nickname: "Jane", avatarEmoji: "🙂" });
	const loaded = getProfile();
	assert.equal(loaded.nickname, "Jane");
	assert.equal(loaded.avatarEmoji, "🙂");
	assert.ok(Number.isFinite(Date.parse(loaded.updatedAt!)));
});

test("saveProfile clamps the nickname, which reaches every prompt", () => {
	const saved = saveProfile({ nickname: "x".repeat(200) });
	assert.equal(saved.nickname?.length, 40);
});

test("saveProfile keeps at most two code points of emoji", () => {
	// Clamping by string length would split a surrogate pair and produce mojibake.
	const saved = saveProfile({ avatarEmoji: "🙂🎉🚀🔥" });
	assert.equal([...saved.avatarEmoji!].length, 2);
});

test("saveProfile treats blank input as unset", () => {
	const saved = saveProfile({ nickname: "   ", avatarEmoji: "" });
	assert.equal(saved.nickname, undefined);
	assert.equal(saved.avatarEmoji, undefined);
});

test("saveProfile leaves no temp file behind", () => {
	saveProfile({ nickname: "Jane" });
	assert.deepEqual(readdirSync(agent()).filter((name) => name.includes(".tmp")), []);
});

test("getProfile survives a corrupt user.json", () => {
	mkdirSync(agent(), { recursive: true });
	writeFileSync(join(agent(), "user.json"), "{ not json", "utf8");
	assert.deepEqual(getProfile(), {});
});

test("capabilities is empty without a settings.json", () => {
	const result = capabilities();
	assert.equal(result.agentDir, agent());
	assert.deepEqual(result.entries, []);
});

test("capabilities lists extensions, skills, prompts and packages", () => {
	mkdirSync(agent(), { recursive: true });
	const real = join(root, "real-extension.ts");
	writeFileSync(real, "export default () => {};", "utf8");
	writeFileSync(
		join(agent(), "settings.json"),
		JSON.stringify({
			extensions: [real, join(root, "gone.ts")],
			skills: ["./skills"],
			prompts: [],
			packages: ["some-npm-package", { source: "./local-package" }],
		}),
		"utf8",
	);

	const entries = capabilities().entries;
	assert.equal(entries.filter((entry) => entry.kind === "extension").length, 2);
	assert.equal(entries.find((entry) => entry.source === real)?.present, true);
	assert.equal(entries.find((entry) => entry.source.endsWith("gone.ts"))?.present, false);
	assert.equal(entries.filter((entry) => entry.kind === "package").length, 2);
	// An npm spec cannot be checked on disk, so it is reported as present.
	assert.equal(entries.find((entry) => entry.source === "some-npm-package")?.present, true);
});

test("capabilities reports a glob pattern verbatim rather than as missing", () => {
	mkdirSync(agent(), { recursive: true });
	writeFileSync(join(agent(), "settings.json"), JSON.stringify({ extensions: ["./ext/*.ts", "!./ext/skip.ts"] }), "utf8");
	const entries = capabilities().entries;
	assert.equal(entries.length, 2);
	assert.ok(entries.every((entry) => entry.present));
});

test("capabilities survives a corrupt settings.json", () => {
	mkdirSync(agent(), { recursive: true });
	writeFileSync(join(agent(), "settings.json"), "]]]", "utf8");
	assert.deepEqual(capabilities().entries, []);
});

test("addExtension appends an absolute path and is idempotent", () => {
	const file = join(root, "ext.ts");
	writeFileSync(file, "export default () => {};", "utf8");

	addExtension(file);
	addExtension(file);

	const settings = JSON.parse(readFileSync(join(agent(), "settings.json"), "utf8")) as { extensions: string[] };
	assert.deepEqual(settings.extensions, [file]);
});

test("addExtension rejects a path that does not exist", () => {
	assert.throws(() => addExtension(join(root, "nope.ts")), /No such extension/);
});

test("removeExtension drops the entry and is safe when absent", () => {
	const file = join(root, "ext.ts");
	writeFileSync(file, "export default () => {};", "utf8");
	addExtension(file);

	assert.deepEqual(removeExtension(file).entries, []);
	assert.deepEqual(removeExtension(file).entries, []);
});

test("addExtension preserves unrelated settings", () => {
	mkdirSync(agent(), { recursive: true });
	writeFileSync(join(agent(), "settings.json"), JSON.stringify({ defaultProvider: "anthropic" }), "utf8");
	const file = join(root, "ext.ts");
	writeFileSync(file, "export default () => {};", "utf8");
	addExtension(file);

	const settings = JSON.parse(readFileSync(join(agent(), "settings.json"), "utf8")) as { defaultProvider?: string };
	assert.equal(settings.defaultProvider, "anthropic");
});

test("extractDocument reads plain text and markdown", () => {
	const result = extractDocument("notes.md", base64("# Title\n\nBody text."));
	assert.match(result.text, /# Title/);
	assert.equal(result.truncated, false);
	assert.equal(result.name, "notes.md");
});

test("extractDocument normalizes CRLF and trims", () => {
	assert.equal(extractDocument("a.txt", base64("  line one\r\nline two  ")).text, "line one\nline two");
});

test("extractDocument truncates a long document and says so", () => {
	// Unbounded text would blow the context window on the first turn.
	const result = extractDocument("big.txt", base64("x".repeat(80_000)));
	assert.equal(result.truncated, true);
	assert.ok(result.text.length < 80_000);
	assert.match(result.text, /truncated/);
});

test("extractDocument accepts an extensionless text file", () => {
	assert.equal(extractDocument("LICENSE", base64("MIT License")).text, "MIT License");
});

test("extractDocument rejects binary content", () => {
	const binary = Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]).toString("base64");
	assert.throws(() => extractDocument("blob.bin", binary), /unsupported or binary/);
});

test("extractDocument refuses PDF rather than extracting it badly", () => {
	// A PDF text layer needs a font-aware parser; a wrong extraction silently
	// feeds the model garbage, which is worse than saying no.
	assert.throws(() => extractDocument("paper.pdf", base64("%PDF-1.7")), /not supported/);
});

test("extractDocument reads a .docx body", (t) => {
	// Builds a minimal .docx with `zip`, so it exercises the real unzip path.
	let zipAvailable = true;
	try {
		execFileSync("which", ["zip"], { stdio: "ignore" });
	} catch {
		zipAvailable = false;
	}
	if (!zipAvailable) return t.skip("zip is unavailable");

	const dir = mkdtempSync(join(tmpdir(), "openpi-docx-fixture-"));
	try {
		mkdirSync(join(dir, "word"), { recursive: true });
		writeFileSync(
			join(dir, "word", "document.xml"),
			'<?xml version="1.0"?><w:document><w:body>' +
				"<w:p><w:r><w:t>First paragraph</w:t></w:r></w:p>" +
				"<w:p><w:r><w:t>Second &amp; last</w:t></w:r></w:p>" +
				"</w:body></w:document>",
			"utf8",
		);
		execFileSync("zip", ["-r", "-q", "doc.docx", "word"], { cwd: dir });
		const data = readFileSync(join(dir, "doc.docx")).toString("base64");

		const result = extractDocument("doc.docx", data);
		assert.match(result.text, /First paragraph/);
		assert.match(result.text, /Second & last/);
		// Paragraphs become separate lines, not one run-together string.
		assert.ok(result.text.includes("\n"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("extractDocument reports a .docx it cannot read", () => {
	assert.throws(() => extractDocument("broken.docx", base64("not a zip")), /Could not read \.docx/);
});
