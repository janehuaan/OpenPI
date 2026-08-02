import * as fs from "node:fs";
import * as path from "node:path";

export interface IntelligenceEvent {
	version: 1;
	runId: string;
	timestamp: string;
	event: string;
	data: Record<string, unknown>;
}

const secretPatterns = [
	/(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^\s"']+/gi,
	/\b(?:sk|cpk)-[A-Za-z0-9_-]{16,}\b/g,
	/-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,
];

export function redactSecrets(value: string): string {
	return secretPatterns.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
}

function sanitize(value: unknown): unknown {
	if (typeof value === "string") return redactSecrets(value);
	if (Array.isArray(value)) return value.map(sanitize);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitize(entry)]));
	}
	return value;
}

export class EventLedger {
	private readonly filePath: string;

	constructor(cwd: string, runId: string) {
		const runDir = path.join(cwd, ".pi", "intelligence", "runs", runId);
		fs.mkdirSync(runDir, { recursive: true });
		this.filePath = path.join(runDir, "events.jsonl");
	}

	append(event: IntelligenceEvent): void {
		const sanitized = sanitize(event);
		fs.appendFileSync(this.filePath, `${JSON.stringify(sanitized)}\n`, "utf8");
	}
}
