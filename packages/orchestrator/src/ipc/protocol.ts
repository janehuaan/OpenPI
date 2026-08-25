import type {
	AgentSessionEvent,
	RpcCommand,
	RpcExtensionUIRequest,
	RpcExtensionUIResponse,
	RpcResponse,
} from "@earendil-works/pi-coding-agent";
import type {
	AgentMode,
	InstanceStatus,
	OrchestratorHealth,
	TaskDefinition,
	TaskRetryPolicy,
	TaskRun,
	TaskSchedule,
	TaskStepRun,
} from "../types.ts";

export interface SpawnRequest {
	type: "spawn";
	cwd: string;
	label?: string;
	mode?: AgentMode;
	provider?: string;
	model?: string;
}

export interface ListRequest {
	type: "list";
}

export interface StopRequest {
	type: "stop";
	instanceId: string;
}

export interface StatusRequest {
	type: "status";
	instanceId: string;
}

export interface RpcRequest {
	type: "rpc";
	instanceId: string;
	command: RpcCommand;
}

export interface RpcBatchRequest {
	type: "rpc_batch";
	instanceId: string;
	commands: RpcCommand[];
}

export interface RpcStreamRequest {
	type: "rpc_stream";
	instanceId: string;
}

export interface SessionRenameRequest {
	type: "session_rename";
	instanceId: string;
	name: string;
}

export interface SessionDeleteRequest {
	type: "session_delete";
	instanceId: string;
}

export interface TaskCreateRequest {
	type: "task_create";
	title: string;
	prompt: string;
	cwd?: string;
	schedule: TaskSchedule;
	retry?: TaskRetryPolicy;
	provider?: string;
	model?: string;
	tools?: string[];
	excludeTools?: string[];
	env?: Record<string, string>;
	extensions?: string[];
	securityMode?: "strict" | "confirm" | "permissive" | "bypass";
	sandbox?: "none" | "docker";
	dockerImage?: string;
}

export interface HealthRequest {
	type: "health";
}

export interface ShutdownRequest {
	type: "shutdown";
}

export interface TaskListRequest {
	type: "task_list";
}

export interface TaskShowRequest {
	type: "task_show";
	taskId: string;
}

export interface TaskRunRequest {
	type: "task_run";
	taskId: string;
}

export interface TaskRunsRequest {
	type: "task_runs";
	taskId?: string;
}

export interface TaskPauseRequest {
	type: "task_pause";
	taskId: string;
	paused: boolean;
}

export interface TaskDeleteRequest {
	type: "task_delete";
	taskId: string;
}

export interface TaskCancelRequest {
	type: "task_cancel";
	runId: string;
}

export interface TaskStepRunsRequest {
	type: "task_step_runs";
	runId: string;
}

export interface RequestMap {
	spawn: SpawnRequest;
	list: ListRequest;
	stop: StopRequest;
	status: StatusRequest;
	rpc: RpcRequest;
	rpc_batch: RpcBatchRequest;
	rpc_stream: RpcStreamRequest;
	session_rename: SessionRenameRequest;
	session_delete: SessionDeleteRequest;
	task_create: TaskCreateRequest;
	task_list: TaskListRequest;
	task_show: TaskShowRequest;
	task_run: TaskRunRequest;
	task_runs: TaskRunsRequest;
	task_pause: TaskPauseRequest;
	task_delete: TaskDeleteRequest;
	task_cancel: TaskCancelRequest;
	task_step_runs: TaskStepRunsRequest;
	health: HealthRequest;
	shutdown: ShutdownRequest;
}

export type OrchestratorRequest = RequestMap[keyof RequestMap];

export interface InstanceSummary {
	id: string;
	status: InstanceStatus;
	mode: AgentMode;
	cwd: string;
	label?: string;
	sessionId?: string;
	sessionFile?: string;
	radiusPiId?: string;
	createdAt?: string;
	lastSeenAt?: string;
}

export interface ResponseBase {
	ok: boolean;
	error?: string;
}

export interface SpawnResponse extends ResponseBase {
	type: "spawn_result";
	instance?: InstanceSummary;
}

export interface ListResponse extends ResponseBase {
	type: "list_result";
	instances?: InstanceSummary[];
}

export interface StopResponse extends ResponseBase {
	type: "stop_result";
	instanceId?: string;
}

export interface StatusResponse extends ResponseBase {
	type: "status_result";
	instance?: InstanceSummary;
}

export interface RpcBridgeResponse extends ResponseBase {
	type: "rpc_result";
	response: RpcResponse;
}

export interface RpcBatchResponse extends ResponseBase {
	type: "rpc_batch_result";
	responses: RpcResponse[];
}

export interface RpcReadyResponse extends ResponseBase {
	type: "rpc_ready";
	instance?: InstanceSummary;
}

export interface SessionMutationResponse extends ResponseBase {
	type: "session_result";
	instance?: InstanceSummary;
	deleted?: boolean;
}

export interface TaskResponse extends ResponseBase {
	type: "task_result";
	task?: TaskDefinition;
	run?: TaskRun;
	deleted?: boolean;
}

export interface TaskListResponse extends ResponseBase {
	type: "task_list_result";
	tasks: TaskDefinition[];
}

export interface TaskRunsResponse extends ResponseBase {
	type: "task_runs_result";
	runs: TaskRun[];
}

export interface TaskStepRunsResponse extends ResponseBase {
	type: "task_step_runs_result";
	stepRuns: TaskStepRun[];
}

export interface HealthResponse extends ResponseBase {
	type: "health_result";
	health?: OrchestratorHealth;
}

export interface ShutdownResponse extends ResponseBase {
	type: "shutdown_result";
}

export interface ErrorResponse extends ResponseBase {
	type: "error";
	ok: false;
	error: string;
}

export interface ResponseMap {
	spawn: SpawnResponse;
	list: ListResponse;
	stop: StopResponse;
	status: StatusResponse;
	rpc: RpcBridgeResponse;
	rpc_batch: RpcBatchResponse;
	rpc_stream: RpcReadyResponse;
	session_rename: SessionMutationResponse;
	session_delete: SessionMutationResponse;
	task_create: TaskResponse;
	task_list: TaskListResponse;
	task_show: TaskResponse;
	task_run: TaskResponse;
	task_runs: TaskRunsResponse;
	task_pause: TaskResponse;
	task_delete: TaskResponse;
	task_cancel: TaskResponse;
	task_step_runs: TaskStepRunsResponse;
	health: HealthResponse;
	shutdown: ShutdownResponse;
}

export type OrchestratorResponse = ResponseMap[keyof ResponseMap] | ErrorResponse;
export type RpcClientMessage = RpcCommand | RpcExtensionUIResponse;
export type RpcServerMessage =
	| RpcReadyResponse
	| RpcResponse
	| AgentSessionEvent
	| RpcExtensionUIRequest
	| ErrorResponse;
export type ProtocolMessage = OrchestratorRequest | OrchestratorResponse | RpcClientMessage | RpcServerMessage;

export type ResponseFor<T extends OrchestratorRequest> = T extends { type: infer K }
	? K extends keyof ResponseMap
		? ResponseMap[K] | ErrorResponse
		: ErrorResponse
	: ErrorResponse;

export function encodeMessage(message: ProtocolMessage): string {
	// Guard against accidental undefined returns from handlers (JSON.stringify(undefined) is undefined).
	if (message === undefined || message === null) {
		return `${JSON.stringify({ type: "error", ok: false, error: "Internal error: empty orchestrator response" })}\n`;
	}
	return `${JSON.stringify(message)}\n`;
}

export function parseRequestLine(line: string): OrchestratorRequest {
	const value = JSON.parse(line) as OrchestratorRequest;
	return value;
}

export function parseResponseLine(line: string): OrchestratorResponse {
	const value = JSON.parse(line) as OrchestratorResponse;
	return value;
}
