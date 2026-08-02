import * as fs from "node:fs";
import * as path from "node:path";
import type { EvaluationResult, MemoryRecord } from "./contract.ts";

const MEMORY_FILE = ".pi/intelligence/memories.json";

export function loadManagedMemories(cwd: string): MemoryRecord[] {
	try {
		const value: unknown = JSON.parse(fs.readFileSync(path.join(cwd, MEMORY_FILE), "utf8"));
		return Array.isArray(value) ? (value as MemoryRecord[]) : [];
	} catch {
		return [];
	}
}

export function saveManagedMemories(cwd: string, records: MemoryRecord[]): void {
	const file = path.join(cwd, MEMORY_FILE);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

function classifyMemory(content: string): MemoryRecord["type"] {
	if (/\b(?:prefer|preference|always use|likes?)\b/i.test(content) || /(?:偏好|喜欢|习惯)/.test(content))
		return "preference";
	if (/\b(?:must|never|constraint|required|forbidden)\b/i.test(content) || /(?:必须|禁止|约束|不得)/.test(content))
		return "constraint";
	if (/\b(?:decided|decision|chosen|selected)\b/i.test(content) || /(?:决定|选择|采用)/.test(content))
		return "decision";
	return "lesson";
}

export function createMemoryCandidate(
	evaluation: EvaluationResult,
	content: string,
	options: { minimumScore: number; minimumConfidence: number; ttlDays: number },
): MemoryRecord | undefined {
	if (
		!evaluation.passed ||
		evaluation.score < options.minimumScore ||
		evaluation.confidence < options.minimumConfidence
	)
		return undefined;
	const normalized = content.trim();
	if (normalized.length < 20 || normalized.length > 2000) return undefined;
	const createdAt = new Date();
	return {
		version: 1,
		id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		type: classifyMemory(normalized),
		content: normalized,
		confidence: Math.min(evaluation.score, evaluation.confidence),
		sourceRunId: evaluation.runId,
		sourceEvaluationId: evaluation.id,
		createdAt: createdAt.toISOString(),
		expiresAt: new Date(createdAt.getTime() + options.ttlDays * 86_400_000).toISOString(),
		status: "active",
	};
}

export function upsertMemory(cwd: string, record: MemoryRecord): MemoryRecord[] {
	const records = expireMemories(loadManagedMemories(cwd));
	const duplicate = records.find(
		(item) => item.status === "active" && item.content.toLowerCase() === record.content.toLowerCase(),
	);
	if (duplicate) {
		duplicate.confidence = Math.max(duplicate.confidence, record.confidence);
		duplicate.expiresAt = record.expiresAt;
	} else records.push(record);
	saveManagedMemories(cwd, records);
	return records;
}

export function correctMemory(cwd: string, id: string, correction: string): MemoryRecord | undefined {
	const records = loadManagedMemories(cwd);
	const record = records.find((item) => item.id === id);
	if (!record) return undefined;
	record.status = "corrected";
	record.correction = correction;
	saveManagedMemories(cwd, records);
	return record;
}

export function expireMemories(records: MemoryRecord[], now = Date.now()): MemoryRecord[] {
	return records.map((record) =>
		record.status === "active" && record.expiresAt && Date.parse(record.expiresAt) <= now
			? { ...record, status: "expired" as const }
			: record,
	);
}

export function memoryCompactionInstructions(cwd: string, limit = 20): string {
	const active = expireMemories(loadManagedMemories(cwd))
		.filter((record) => record.status === "active")
		.slice(-limit);
	if (active.length === 0) return "";
	return `Preserve these validated project memories in the compaction summary:\n${active.map((record) => `- [${record.type}] ${record.content}`).join("\n")}`;
}
