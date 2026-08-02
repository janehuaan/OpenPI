import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ApprovalRecord, PlanNode, RiskLevel } from "./contract.ts";

const riskOrder: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const QUEUE_FILE = ".pi/intelligence/approvals.json";

export function requiresApproval(risk: RiskLevel, threshold: "high" | "critical"): boolean {
	return riskOrder[risk] >= riskOrder[threshold];
}

export function loadApprovalQueue(cwd: string, now = Date.now()): ApprovalRecord[] {
	let records: ApprovalRecord[];
	try {
		const value: unknown = JSON.parse(fs.readFileSync(path.join(cwd, QUEUE_FILE), "utf8"));
		records = Array.isArray(value) ? (value as ApprovalRecord[]) : [];
	} catch {
		records = [];
	}
	let changed = false;
	for (const record of records) {
		if (record.decision === "pending" && record.expiresAt && Date.parse(record.expiresAt) <= now) {
			record.decision = "expired";
			record.reason = "Approval request expired.";
			record.resolvedAt = new Date(now).toISOString();
			changed = true;
		}
	}
	if (changed) saveApprovalQueue(cwd, records);
	return records;
}

export function saveApprovalQueue(cwd: string, records: ApprovalRecord[]): void {
	const file = path.join(cwd, QUEUE_FILE);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(records, null, 2)}\n`, "utf8");
}

export function resolveApproval(
	cwd: string,
	id: string,
	approved: boolean,
	reason: string,
): ApprovalRecord | undefined {
	const records = loadApprovalQueue(cwd);
	const record = records.find((item) => item.id === id && item.decision === "pending");
	if (!record) return undefined;
	record.decision = approved ? "approved" : "denied";
	record.reason = reason;
	record.resolvedAt = new Date().toISOString();
	saveApprovalQueue(cwd, records);
	return record;
}

export async function requestNodeApproval(
	ctx: ExtensionContext,
	runId: string,
	node: PlanNode,
	threshold: "high" | "critical",
): Promise<ApprovalRecord> {
	const required = requiresApproval(node.risk, threshold);
	let decision: ApprovalRecord["decision"] = "approved";
	let reason = "Risk below approval threshold.";
	if (required && !ctx.hasUI) {
		decision = "pending";
		reason = "Queued for approval because no interactive UI is available.";
	} else if (required) {
		const approved = await ctx.ui.confirm(
			`Approve ${node.risk}-risk plan node?`,
			`${node.title}\n\n${node.objective}\n\nCapabilities: ${node.capabilityIds.join(", ")}`,
		);
		decision = approved ? "approved" : "denied";
		reason = approved ? "User approved execution." : "User denied execution.";
	}
	const createdAt = new Date();
	const record: ApprovalRecord = {
		version: 1,
		id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		runId,
		nodeId: node.id,
		risk: node.risk,
		decision,
		reason,
		createdAt: createdAt.toISOString(),
		expiresAt: required ? new Date(createdAt.getTime() + 86_400_000).toISOString() : undefined,
		resolvedAt: decision === "pending" ? undefined : createdAt.toISOString(),
	};
	const records = loadApprovalQueue(ctx.cwd);
	records.push(record);
	saveApprovalQueue(ctx.cwd, records);
	return record;
}
