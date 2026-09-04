export {
	defaultWorkspace,
	deleteMemory,
	listMemory,
	type MemoryEntry,
	modelCatalog,
	type ModelOption,
	parseMemoryIndex,
	providerStatus,
	type ProviderStatus,
	readMemoryTopic,
	recentWorkspaces,
	runPiCommand,
	workspaceSummary,
	type WorkspaceSummary,
	writeMemory,
} from "./app-ops.ts";
export { bootstrapCredentials, listProviders, type BootstrapResult } from "./bootstrap.ts";
export {
	agentDir,
	globalAgentDir,
	openpiDir,
	piCliMtimeMs,
	piCli,
	piRpcEntry,
	sessionsDir,
	socketPath,
	VERSION,
} from "./config.ts";
export { DaemonClient, isDaemonLive } from "./ipc/client.ts";
export { type Connection, startServer } from "./ipc/server.ts";
export {
	addExtension,
	capabilities,
	extractDocument,
	getProfile,
	installPackage,
	removeExtension,
	removePackage,
	saveProfile,
} from "./profile-ops.ts";
export { buildRpcArgs, RpcProcess } from "./rpc-process.ts";
export {
	cancelRun,
	createTask,
	deleteTask,
	ensureScheduler,
	listTasks,
	readRunLog,
	runTaskNow,
	setTaskPaused,
	stepRuns,
	stopScheduler,
	type TaskWithRuns,
} from "./scheduler-ops.ts";
export { serve } from "./serve.ts";
export { Supervisor } from "./supervisor.ts";
