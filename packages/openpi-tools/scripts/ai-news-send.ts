#!/usr/bin/env node
/**
 * Adapter: send email via Gmail SMTP using curl (zero npm deps).
 * Reads credentials from ~/.pi/agent/secrets.env:
 *   GMAIL_SMTP_USER, GMAIL_SMTP_PASSWORD, GMAIL_NEWS_TO (default recipient)
 *
 * Usage:
 *   ai-news-send.ts --subject "AI 早报" --body-file /tmp/body.txt [--to x@y.com]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";

function loadSecrets(): Record<string, string> {
	const secrets: Record<string, string> = {};
	const path = join(homedir(), ".pi", "agent", "secrets.env");
	try {
		for (const line of readFileSync(path, "utf8").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq <= 0) continue;
			secrets[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
		}
	} catch {
		// missing secrets file: env vars may be set instead
	}
	return secrets;
}

function base64Utf8(value: string): string {
	return Buffer.from(value, "utf8").toString("base64");
}

function run(command: string, args: string[]): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
		child.once("error", reject);
		child.once("close", (code) => resolve(code ?? 1));
	});
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const subjectIndex = args.indexOf("--subject");
	const bodyIndex = args.indexOf("--body-file");
	const toIndex = args.indexOf("--to");
	if (subjectIndex < 0 || bodyIndex < 0) {
		console.error("Usage: ai-news-send.ts --subject <subject> --body-file <path> [--to <email>]");
		process.exit(1);
	}
	const subject = args[subjectIndex + 1] ?? "AI 早报";
	const bodyPath = args[bodyIndex + 1] ?? "";
	const to = toIndex >= 0 ? args[toIndex + 1] : undefined;

	const secrets = loadSecrets();
	const user = secrets.GMAIL_SMTP_USER ?? process.env.GMAIL_SMTP_USER;
	const password = secrets.GMAIL_SMTP_PASSWORD ?? process.env.GMAIL_SMTP_PASSWORD;
	const defaultTo = secrets.GMAIL_NEWS_TO ?? process.env.GMAIL_NEWS_TO;
	if (!user || !password) {
		console.error("Missing GMAIL_SMTP_USER / GMAIL_SMTP_PASSWORD (secrets.env or env)");
		process.exit(1);
	}
	const recipient = to ?? defaultTo;
	if (!recipient) {
		console.error("Missing recipient: pass --to or set GMAIL_NEWS_TO");
		process.exit(1);
	}

	const body = readFileSync(bodyPath, "utf8");
	const workdir = mkdtempSync(join("/tmp", "openpi-mail-"));
	const mailFile = join(workdir, "mail.txt");
	writeFileSync(
		mailFile,
		[
			`From: ${user}`,
			`To: ${recipient}`,
			`Subject: =?UTF-8?B?${base64Utf8(subject)}?=`,
			"MIME-Version: 1.0",
			"Content-Type: text/plain; charset=UTF-8",
			"Content-Transfer-Encoding: 8bit",
			"",
			body,
			"",
		].join("\r\n"),
	);

	const code = await run("curl", [
		"-s",
		"--url",
		"smtp://smtp.gmail.com:587",
		"--ssl-reqd",
		"--mail-from",
		user,
		"--mail-rcpt",
		recipient,
		"--user",
		`${user}:${password}`,
		"--upload-file",
		mailFile,
	]);
	rmSync(workdir, { recursive: true, force: true });
	if (code !== 0) {
		console.error(`SMTP send failed (curl exit ${code})`);
		process.exit(code);
	}
	console.log(`mail sent: "${subject}" -> ${recipient}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
