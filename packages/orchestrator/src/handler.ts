import type {
	AgentSessionEvent,
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
} from "@earendil-works/pi-coding-agent";
import type {
	ErrorResponse,
	HealthRequest,
	HealthResponse,
	InstanceSummary,
	ListRequest,
	ListResponse,
	OrchestratorRequest,
	OrchestratorResponse,
	RpcBatchRequest,
	RpcBatchResponse,
	RpcBridgeResponse,
	RpcReadyResponse,
	RpcRequest,
	RpcStreamRequest,
	SessionDeleteRequest,
	SessionMutationResponse,
	SessionRenameRequest,
	ShutdownRequest,
	ShutdownResponse,
	SpawnRequest,
	SpawnResponse,
	StatusRequest,
	StatusResponse,
	StopRequest,
	StopResponse,
} from "./ipc/protocol.ts";
import { supervisor } from "./supervisor.ts";
import { taskScheduler } from "./task-scheduler.ts";
import type { InstanceRecord } from "./types.ts";

let shutdownHandler: (() => void) | undefined;

export function setShutdownHandler(handler: (() => void) | undefined): void {
	shutdownHandler = handler;
}

function toInstanceSummary(instance: InstanceRecord): InstanceSummary {
	return {
		id: instance.id,
		status: instance.status,
		mode: instance.mode,
		cwd: instance.cwd,
		label: instance.label,
		sessionId: instance.sessionId,
		sessionFile: instance.sessionFile,
		radiusPiId: instance.radiusPiId,
	};
}

function unknownInstanceError(instanceId: string): ErrorResponse {
	return {
		type: "error",
		ok: false,
		error: `Unknown instance: ${instanceId}`,
	};
}

// Overhead types
export async function handleIpcRequest(request: SpawnRequest): Promise<SpawnResponse | ErrorResponse>;
export async function handleIpcRequest(request: ListRequest): Promise<ListResponse | ErrorResponse>;
export async function handleIpcRequest(request: StopRequest): Promise<StopResponse | ErrorResponse>;
export async function handleIpcRequest(request: StatusRequest): Promise<StatusResponse | ErrorResponse>;
export async function handleIpcRequest(request: RpcRequest): Promise<RpcBridgeResponse | ErrorResponse>;
export async function handleIpcRequest(request: RpcBatchRequest): Promise<RpcBatchResponse | ErrorResponse>;
export async function handleIpcRequest(request: RpcStreamRequest): Promise<RpcReadyResponse | ErrorResponse>;
export async function handleIpcRequest(request: SessionRenameRequest): Promise<SessionMutationResponse | ErrorResponse>;
export async function handleIpcRequest(request: SessionDeleteRequest): Promise<SessionMutationResponse | ErrorResponse>;
export async function handleIpcRequest(request: OrchestratorRequest): Promise<OrchestratorResponse>;
export async function handleIpcRequest(request: OrchestratorRequest): Promise<OrchestratorResponse> {
	switch (request.type) {
		case "spawn": {
			const instance = await supervisor.spawnInstance({
				cwd: request.cwd,
				label: request.label,
				mode: request.mode ?? "work",
			});
			return {
				type: "spawn_result",
				ok: true,
				instance: toInstanceSummary(instance),
			};
		}

		case "list": {
			return {
				type: "list_result",
				ok: true,
				instances: supervisor.listInstances().map(toInstanceSummary),
			};
		}

		case "status": {
			const instance = supervisor.getInstance(request.instanceId);
			if (!instance) {
				return unknownInstanceError(request.instanceId);
			}

			return {
				type: "status_result",
				ok: true,
				instance: toInstanceSummary(instance),
			};
		}

		case "stop": {
			const instance = await supervisor.stopInstance(request.instanceId);
			if (!instance) {
				return unknownInstanceError(request.instanceId);
			}

			return {
				type: "stop_result",
				ok: true,
				instanceId: request.instanceId,
			};
		}

		case "rpc": {
			const response = await supervisor.handleRpc(request.instanceId, request.command);
			if (!response) {
				return unknownInstanceError(request.instanceId);
			}

			return {
				type: "rpc_result",
				ok: true,
				response,
			};
		}

		case "rpc_batch": {
			const responses = await supervisor.handleRpcBatch(request.instanceId, request.commands);
			if (!responses) {
				return unknownInstanceError(request.instanceId);
			}

			return {
				type: "rpc_batch_result",
				ok: true,
				responses,
			};
		}

		case "rpc_stream": {
			const instance = await supervisor.resumeInstance(request.instanceId);
			if (!instance) {
				return unknownInstanceError(request.instanceId);
			}
			return {
				type: "rpc_ready",
				ok: true,
				instance: toInstanceSummary(instance),
			};
		}
		case "session_rename": {
			const instance = await supervisor.renameInstance(request.instanceId, request.name);
			if (!instance) {
				return unknownInstanceError(request.instanceId);
			}
			return { type: "session_result", ok: true, instance: toInstanceSummary(instance) };
		}
		case "session_delete": {
			const deleted = await supervisor.deleteInstance(request.instanceId);
			if (!deleted) {
				return unknownInstanceError(request.instanceId);
			}
			return { type: "session_result", ok: true, deleted: true };
		}
		case "task_create":
			return { type: "task_result", ok: true, task: taskScheduler.createTask(request) };
		case "task_list":
			return { type: "task_list_result", ok: true, tasks: taskScheduler.listTasks() };
		case "task_show": {
			const task = taskScheduler.getTask(request.taskId);
			return task
				? { type: "task_result", ok: true, task }
				: { type: "error", ok: false, error: `Unknown task: ${request.taskId}` };
		}
		case "task_run":
			return { type: "task_result", ok: true, run: await taskScheduler.trigger(request.taskId) };
		case "task_runs":
			return { type: "task_runs_result", ok: true, runs: taskScheduler.listRuns(request.taskId) };
		case "task_pause": {
			const task = taskScheduler.setPaused(request.taskId, request.paused);
			return task
				? { type: "task_result", ok: true, task }
				: { type: "error", ok: false, error: `Unknown task: ${request.taskId}` };
		}
		case "task_delete":
			return {
				type: "task_result",
				ok: true,
				deleted: taskScheduler.deleteTask(request.taskId),
			};
		case "task_cancel": {
			const run = taskScheduler.cancel(request.runId);
			return run
				? { type: "task_result", ok: true, run }
				: { type: "error", ok: false, error: `Unknown run: ${request.runId}` };
		}
		case "task_step_runs": {
			const stepRuns = taskScheduler.getStepRuns(request.runId);
			return { type: "task_step_runs_result", ok: true, stepRuns };
		}
		case "health": {
			const _request: HealthRequest = request;
			void _request;
			return { type: "health_result", ok: true, health: taskScheduler.health() } satisfies HealthResponse;
		}
		case "shutdown": {
			const _request: ShutdownRequest = request;
			void _request;
			queueMicrotask(() => {
				shutdownHandler?.();
			});
			return { type: "shutdown_result", ok: true } satisfies ShutdownResponse;
		}
		default: {
			const unknownType =
				request && typeof request === "object" && "type" in request
					? String((request as { type: unknown }).type)
					: "unknown";
			return { type: "error", ok: false, error: `Unknown orchestrator request type: ${unknownType}` };
		}
	}
}

export function openRpcStream(
	instanceId: string,
	onResponse: (response: RpcResponse) => void,
	onSessionEvent: (event: AgentSessionEvent) => void,
	onUiRequest: (request: RpcExtensionUIRequest) => void,
):
	| {
			handleRequest(request: RpcCommand | RpcExtensionUIResponse): Promise<void>;
			close(): void;
	  }
	| undefined {
	const handle = supervisor.openRpcStream(instanceId, onSessionEvent, onUiRequest);
	if (!handle) {
		return undefined;
	}

	return {
		async handleRequest(request): Promise<void> {
			if (request.type === "extension_ui_response") {
				handle.handleUiResponse(request);
				return;
			}
			const response = await handle.handleRpc(request);
			onResponse(response);
		},
		close(): void {
			handle.close();
		},
	};
}
