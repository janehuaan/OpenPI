import { type ChildProcess, spawn } from "node:child_process";
import * as path from "node:path";
import type { AgentProfile, DelegatedTask, PlanNode, SelectedContext } from "./contract.ts";

export interface DelegateOptions {
	cwd: string;
	runId: string;
	planId: string;
	node: PlanNode;
	profile: AgentProfile;
	context: SelectedContext[];
	maxConcurrent: number;
}

export class DynamicSubAgentManager {
	private readonly tasks = new Map<string, DelegatedTask>();
	private readonly children = new Map<string, ChildProcess>();

	private resolvePiEntry(): string {
		const entry = process.argv[1];
		if (!entry) throw new Error("Cannot resolve the current pi CLI entry point.");
		return path.resolve(entry);
	}

	list(): DelegatedTask[] {
		return [...this.tasks.values()];
	}

	get(id: string): DelegatedTask | undefined {
		return this.tasks.get(id);
	}

	delegate(options: DelegateOptions): DelegatedTask {
		const running = this.list().filter((task) => task.status === "running").length;
		if (running >= options.maxConcurrent)
			throw new Error(`Sub-agent concurrency limit ${options.maxConcurrent} reached.`);
		const task: DelegatedTask = {
			version: 1,
			id: `delegate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			runId: options.runId,
			planId: options.planId,
			nodeId: options.node.id,
			profile: options.profile,
			status: "queued",
			createdAt: new Date().toISOString(),
		};
		this.tasks.set(task.id, task);
		const selected = options.context.filter((item) => options.profile.contextItemIds.includes(item.candidate.id));
		const context = selected
			.map((item) => `<context uri="${item.candidate.uri}">\n${item.selectedContent}\n</context>`)
			.join("\n");
		const prompt = [
			`Role: ${options.profile.role}`,
			`Objective: ${options.profile.objective}`,
			`Success criteria:\n${options.node.successCriteria.map((item) => `- ${item}`).join("\n")}`,
			context ? `Context:\n${context}` : "",
			"Return a concise result with concrete evidence.",
		]
			.filter(Boolean)
			.join("\n\n");
		const tools = options.profile.allowedCapabilityIds
			.filter((id) => id.startsWith("tool:"))
			.map((id) => id.slice(5));
		const args = [this.resolvePiEntry(), "--no-session", "--print"];
		if (options.profile.provider) args.push("--provider", options.profile.provider);
		if (options.profile.model) args.push("--model", options.profile.model);
		if (tools.length > 0) args.push("--tools", tools.join(","));
		args.push(prompt);
		const child = spawn(process.execPath, args, {
			cwd: options.cwd,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		task.status = "running";
		task.pid = child.pid;
		task.startedAt = new Date().toISOString();
		this.children.set(task.id, child);
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
		const timeout = setTimeout(() => {
			if (task.status !== "running") return;
			task.status = "timed-out";
			task.error = `Timed out after ${options.profile.timeoutMs}ms.`;
			task.completedAt = new Date().toISOString();
			child.kill("SIGTERM");
		}, options.profile.timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timeout);
			task.status = "failed";
			task.error = error.message;
			task.completedAt = new Date().toISOString();
			this.children.delete(task.id);
		});
		child.on("close", (code) => {
			clearTimeout(timeout);
			if (task.status === "running") {
				task.status = code === 0 ? "completed" : "failed";
				task.result = Buffer.concat(stdout).toString("utf8").trim();
				task.error =
					code === 0 ? undefined : Buffer.concat(stderr).toString("utf8").trim() || `Exited with code ${code}.`;
				task.completedAt = new Date().toISOString();
			}
			this.children.delete(task.id);
		});
		return task;
	}

	cancel(id: string): boolean {
		const task = this.tasks.get(id);
		if (!task || (task.status !== "queued" && task.status !== "running")) return false;
		this.children.get(id)?.kill("SIGTERM");
		task.status = "cancelled";
		task.completedAt = new Date().toISOString();
		this.children.delete(id);
		return true;
	}
}

export function createAgentProfile(
	node: PlanNode,
	context: SelectedContext[],
	options: { provider?: string; model?: string; timeoutMs: number; maxContextItems: number },
): AgentProfile {
	return {
		version: 1,
		id: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		role: node.title,
		objective: node.objective,
		allowedCapabilityIds: [...node.capabilityIds],
		contextItemIds: context.slice(0, options.maxContextItems).map((item) => item.candidate.id),
		provider: options.provider,
		model: options.model,
		maxTurns: 8,
		timeoutMs: options.timeoutMs,
		writePaths: [],
		risk: node.risk,
	};
}
