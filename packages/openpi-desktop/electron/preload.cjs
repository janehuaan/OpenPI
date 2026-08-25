const { contextBridge, ipcRenderer } = require("electron");

/** Keep in sync with electron/ipc-channels.mjs */
const ALLOWED = new Set([
	"get_snapshot",
	"start_daemon",
	"stop_daemon",
	"restart_daemon",
	"stop_instance",
	"prune_stopped_instances",
	"create_conversation",
	"select_workspace",
	"get_workspace_summary",
	"read_workspace_file",
	"extract_document_text",
	"get_conversation",
	"get_conversation_stats",
	"get_provider_balance",
	"get_session_todo",
	"send_message",
	"abort_conversation",
	"rename_conversation",
	"delete_conversation",
	"get_conversation_models",
	"get_available_models",
	"get_model_catalog",
	"set_conversation_model",
	"set_conversation_thinking_level",
	"get_conversation_capabilities",
	"reload_conversation_capabilities",
	"install_conversation_package",
	"remove_conversation_package",
	"get_conversation_commands",
	"watch_conversation_stream",
	"stop_conversation_stream",
	"respond_conversation_ui",
	"create_task",
	"set_task_paused",
	"delete_task",
	"run_task",
	"cancel_run",
	"read_run_log",
	"list_memory_index",
	"write_memory_entry",
	"delete_memory_entry",
	"memory_meta",
	"maintain_memory",
	"list_intelligence_runs",
	"read_intelligence_run",
	"setup_status",
	"default_workspace",
	"get_user_profile",
	"save_user_profile",
	"get_model_providers",
	"get_provider_auth_status",
	"get_status_segments",
	"provider_login",
	"provider_logout",
	"open_external",
	"get_vision_fallback",
	"get_vision_fallback_models",
	"configure_vision_fallback",
	"get_auto_start_milvus",
	"set_auto_start_milvus",
	"save_model_provider",
	"delete_model_provider",
	"get_media_capabilities",
	"generate_image",
	"create_video",
	"get_video",
	"save_media",
	"start_speech_recognition",
	"stop_speech_recognition",
]);

contextBridge.exposeInMainWorld("openpi", {
	isNative: true,
	invoke: (channel, args) => {
		if (typeof channel !== "string" || !ALLOWED.has(channel)) {
			return Promise.reject(new Error(`Blocked IPC channel: ${String(channel)}`));
		}
		return ipcRenderer.invoke(`openpi:${channel}`, args);
	},
	onConversationEvent: (handler) => {
		const listener = (_event, payload) => handler(payload);
		ipcRenderer.on("openpi:conversation-event", listener);
		return () => ipcRenderer.removeListener("openpi:conversation-event", listener);
	},
	onRefreshData: (handler) => {
		const listener = () => handler();
		ipcRenderer.on("openpi:refresh-data", listener);
		return () => ipcRenderer.removeListener("openpi:refresh-data", listener);
	},
	onSpeechEvent: (handler) => {
		const listener = (_event, payload) => handler(payload);
		ipcRenderer.on("openpi:speech-event", listener);
		return () => ipcRenderer.removeListener("openpi:speech-event", listener);
	},
	onDaemonRestartDeferred: (handler) => {
		const listener = () => handler();
		ipcRenderer.on("openpi:daemon-restart-deferred", listener);
		return () => ipcRenderer.removeListener("openpi:daemon-restart-deferred", listener);
	},
});
