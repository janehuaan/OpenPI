/**
 * web-fetch.ts and secrets.ts coverage.
 *
 * stripHtml is what the model actually reads after a fetch, so mangled output
 * here degrades every downstream answer. secrets.ts resolves API keys for four
 * tools; its precedence rule (env before file) is worth pinning.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentDir, agentStatePath, clearSecretsCache, envOrSecret, loadAgentSecrets } from "../src/secrets.ts";
import { extractTitle, stripHtml } from "../src/web-fetch.ts";

describe("stripHtml", () => {
	it("drops script and style bodies entirely", () => {
		const html = `
			<html><head><style>body { color: red }</style></head>
			<body><script>alert("hi")</script><p>Real content</p></body></html>`;
		const text = stripHtml(html);
		expect(text).toContain("Real content");
		expect(text).not.toContain("color: red");
		expect(text).not.toContain("alert");
	});

	it("removes tags but keeps their text", () => {
		expect(stripHtml("<h1>Title</h1><p>Body <b>bold</b></p>")).toBe("Title Body bold");
	});

	it("decodes the common entities", () => {
		expect(stripHtml("<p>a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;</p>")).toBe(`a & b <c> "d" 'e'`);
	});

	it("collapses whitespace and trims", () => {
		expect(stripHtml("<p>one</p>\n\n\t<p>two</p>   ")).toBe("one two");
	});

	it("handles empty and tag-only input", () => {
		expect(stripHtml("")).toBe("");
		expect(stripHtml("<div></div>")).toBe("");
	});

	it("does not throw on an unterminated tag", () => {
		expect(() => stripHtml("<p>text <span")).not.toThrow();
	});

	it("keeps CJK text intact", () => {
		expect(stripHtml("<p>中文内容 &amp; 英文</p>")).toBe("中文内容 & 英文");
	});
});

describe("extractTitle", () => {
	it("reads the title element", () => {
		expect(extractTitle("<html><head><title>Page Title</title></head></html>")).toBe("Page Title");
	});

	it("trims surrounding whitespace", () => {
		expect(extractTitle("<title>\n  Spaced  \n</title>")).toBe("Spaced");
	});

	it("handles a title element with attributes", () => {
		expect(extractTitle('<title data-x="1">With Attrs</title>')).toBe("With Attrs");
	});

	it("returns undefined when there is no title", () => {
		expect(extractTitle("<html><body>no title</body></html>")).toBeUndefined();
		expect(extractTitle("")).toBeUndefined();
	});
});

describe("agent directory", () => {
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

	afterEach(() => {
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		clearSecretsCache();
	});

	it("honors PI_CODING_AGENT_DIR, which the daemon sets per session", () => {
		process.env.PI_CODING_AGENT_DIR = "/tmp/openpi-test-agent";
		expect(agentDir()).toBe("/tmp/openpi-test-agent");
		expect(agentStatePath("monitor.json")).toBe(path.join("/tmp/openpi-test-agent", "monitor.json"));
	});

	it("defaults to openpi's own directory, not the pi CLI's", () => {
		// The old package defaulted to ~/.pi/agent, sharing a secrets file with a
		// user's own pi install.
		delete process.env.PI_CODING_AGENT_DIR;
		expect(agentDir()).toBe(path.join(os.homedir(), ".openpi", "agent"));
	});
});

describe("secrets resolution", () => {
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-secrets-"));
		process.env.PI_CODING_AGENT_DIR = dir;
		clearSecretsCache();
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		delete process.env.OPENPI_TEST_KEY;
		clearSecretsCache();
	});

	function writeSecrets(contents: string): void {
		fs.writeFileSync(path.join(dir, "secrets.env"), contents, "utf8");
	}

	it("parses KEY=value lines", () => {
		writeSecrets("TAVILY_API_KEY=abc123\nGITHUB_TOKEN=ghp_xyz\n");
		const secrets = loadAgentSecrets();
		expect(secrets.TAVILY_API_KEY).toBe("abc123");
		expect(secrets.GITHUB_TOKEN).toBe("ghp_xyz");
	});

	it("strips single and double quotes", () => {
		writeSecrets(`A="double"\nB='single'\n`);
		const secrets = loadAgentSecrets();
		expect(secrets.A).toBe("double");
		expect(secrets.B).toBe("single");
	});

	it("ignores comments, blanks and lines with no key", () => {
		writeSecrets("# a comment\n\n=novalue\nREAL=yes\n");
		const secrets = loadAgentSecrets();
		expect(secrets.REAL).toBe("yes");
		expect(Object.keys(secrets)).toEqual(["REAL"]);
	});

	it("keeps '=' inside a value", () => {
		writeSecrets("URL=https://example.com/?a=1&b=2\n");
		expect(loadAgentSecrets().URL).toBe("https://example.com/?a=1&b=2");
	});

	it("returns an empty map when the file does not exist", () => {
		expect(loadAgentSecrets()).toEqual({});
	});

	it("prefers the process environment over the file", () => {
		writeSecrets("OPENPI_TEST_KEY=from-file\n");
		process.env.OPENPI_TEST_KEY = "from-env";
		expect(envOrSecret("OPENPI_TEST_KEY")).toBe("from-env");
	});

	it("falls back to the file when the env var is unset", () => {
		writeSecrets("OPENPI_TEST_KEY=from-file\n");
		expect(envOrSecret("OPENPI_TEST_KEY")).toBe("from-file");
	});

	it("tries names in order, which is how OPENPI_* aliases work", () => {
		writeSecrets("TAVILY_API_KEY=fallback\n");
		expect(envOrSecret("OPENPI_TAVILY_API_KEY", "TAVILY_API_KEY")).toBe("fallback");
	});

	it("returns undefined when no name resolves", () => {
		expect(envOrSecret("NOPE_A", "NOPE_B")).toBeUndefined();
	});

	it("ignores a whitespace-only value", () => {
		process.env.OPENPI_TEST_KEY = "   ";
		writeSecrets("OPENPI_TEST_KEY=real\n");
		expect(envOrSecret("OPENPI_TEST_KEY")).toBe("real");
	});
});
