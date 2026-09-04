/**
 * IPC channel contract, shared by the preload allowlist and the main-process
 * handlers.
 *
 * Single source of truth on purpose. In the old fork the allowlist lived in
 * `preload.cjs` and a second list in `ipc-channels.mjs`, with a comment saying
 * "keep in sync" - and they had already drifted (two channels existed only in
 * the preload). Tests covered the list that was not the one enforcing anything.
 */

/** Request channels: renderer calls, main answers. */
export const INVOKE_CHANNELS = [
	// daemon lifecycle
	"daemon_health",
	"daemon_start",
	"daemon_restart",
	// sessions
	"list_sessions",
	"create_session",
	"stop_session",
	"delete_session",
	"subscribe_session",
	"unsubscribe_session",
	"session_rpc",
	"rename_session",
	// app-level
	"auth_status",
	"list_models",
	"import_credentials",
	"default_workspace",
	"recent_workspaces",
	"workspace_summary",
	"list_memory",
	"read_memory_topic",
	"write_memory",
	"delete_memory",
	// scheduled tasks
	"list_tasks",
	"create_task",
	"set_task_paused",
	"delete_task",
	"run_task",
	"cancel_run",
	"step_runs",
	"read_run_log",
	// profile, capabilities, documents
	"get_profile",
	"save_profile",
	"capabilities",
	"add_extension",
	"remove_extension",
	"install_package",
	"remove_package",
	"extract_document",
	// native capabilities, the only things that must live in the main process
	"select_workspace",
	"open_external",
	"show_item_in_folder",
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];

/** Push channels: main sends, renderer listens. */
export const EVENT_CHANNELS = [
	"session_event",
	"daemon_status",
	"refresh_data",
] as const;

export type EventChannel = (typeof EVENT_CHANNELS)[number];

export const CHANNEL_PREFIX = "openpi:";

export function invokeChannelName(channel: InvokeChannel): string {
	return `${CHANNEL_PREFIX}${channel}`;
}

export function eventChannelName(channel: EventChannel): string {
	return `${CHANNEL_PREFIX}${channel}`;
}
