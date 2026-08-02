import * as fs from "node:fs";
import * as path from "node:path";
import type { ContextCandidate } from "../../contract.ts";
import { createCandidate, queryTerms } from "../utils.ts";

export function collectMemoryCandidates(cwd: string, query: string): ContextCandidate[] {
	const memoryDir = path.join(cwd, ".pi", "memory");
	const terms = queryTerms(query);
	const managedPath = path.join(cwd, ".pi", "intelligence", "memories.json");
	let managed: ContextCandidate[] = [];
	try {
		const value: unknown = JSON.parse(fs.readFileSync(managedPath, "utf8"));
		if (Array.isArray(value)) {
			managed = value.flatMap((record) => {
				if (
					!record ||
					typeof record !== "object" ||
					!("status" in record) ||
					record.status !== "active" ||
					!("content" in record) ||
					typeof record.content !== "string"
				)
					return [];
				if (terms.length > 0 && !terms.some((term) => record.content.toLowerCase().includes(term))) return [];
				const id = "id" in record && typeof record.id === "string" ? record.id : "managed";
				return [
					createCandidate(
						"memory",
						`managed:${id}`,
						"Validated managed memory",
						record.content,
						"managed-memory",
						{ authority: true },
					),
				];
			});
		}
	} catch {
		/* No managed memory yet. */
	}
	if (!fs.existsSync(memoryDir)) return managed;
	const files = fs
		.readdirSync(memoryDir)
		.filter((file) => file.endsWith(".md"))
		.slice(0, 50);
	return [
		...managed,
		...files.flatMap((file) => {
			const absolute = path.join(memoryDir, file);
			let content: string;
			try {
				content = fs.readFileSync(absolute, "utf8");
			} catch {
				return [];
			}
			const text = content.toLowerCase();
			if (file !== "MEMORY.md" && !terms.some((term) => text.includes(term))) return [];
			return [
				createCandidate("memory", `.pi/memory/${file}`, file, content.slice(0, 24_000), "memory", {
					attention: file === "MEMORY.md",
				}),
			];
		}),
	];
}
