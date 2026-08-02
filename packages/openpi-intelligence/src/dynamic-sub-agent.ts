import type { AgentProfile, DelegatedTask, PlanNode, SelectedContext } from "./contract.ts";
import { type SpawnPiHandle, spawnPiPrint } from "./spawn-pi.ts";

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
	private readonly handles = new Map<string, SpawnPiHandle>();

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
		const handle = spawnPiPrint({
			cwd: options.cwd,
			prompt,
			provider: options.profile.provider,
			model: options.profile.model,
			tools,
			noSession: true,
			timeoutMs: options.profile.timeoutMs,
		});
		task.status = "running";
		task.pid = handle.pid;
		task.startedAt = new Date().toISOString();
		this.handles.set(task.id, handle);
		void handle.completion
			.then((result) => {
				if (task.status !== "running") return;
				task.status = result.exitCode === 0 ? "completed" : "failed";
				task.result = result.stdout;
				task.error = result.exitCode === 0 ? undefined : result.stderr || `Exited with code ${result.exitCode}.`;
				task.completedAt = new Date().toISOString();
				this.handles.delete(task.id);
			})
			.catch((error: unknown) => {
				if (task.status !== "running") return;
				task.status = "failed";
				task.error = error instanceof Error ? error.message : String(error);
				task.completedAt = new Date().toISOString();
				this.handles.delete(task.id);
			});
		// Mark timed-out if completion resolves after kill from timeout path — spawnPiPrint kills process.
		// When killed mid-run with non-zero, status becomes failed; detect timeout via empty stderr message pattern optional.
		return task;
	}

	cancel(id: string): boolean {
		const task = this.tasks.get(id);
		if (!task || (task.status !== "queued" && task.status !== "running")) return false;
		this.handles.get(id)?.cancel();
		task.status = "cancelled";
		task.completedAt = new Date().toISOString();
		this.handles.delete(id);
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
