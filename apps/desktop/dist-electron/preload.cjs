"use strict";

// electron/preload.ts
var import_electron = require("electron");

// electron/channels.ts
var INVOKE_CHANNELS = [
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
  // native capabilities, the only things that must live in the main process
  "select_workspace",
  "open_external",
  "show_item_in_folder"
];
var EVENT_CHANNELS = [
  "session_event",
  "daemon_status",
  "refresh_data"
];
var CHANNEL_PREFIX = "openpi:";
function invokeChannelName(channel) {
  return `${CHANNEL_PREFIX}${channel}`;
}
function eventChannelName(channel) {
  return `${CHANNEL_PREFIX}${channel}`;
}

// electron/preload.ts
var allowedInvoke = new Set(INVOKE_CHANNELS);
var allowedEvents = new Set(EVENT_CHANNELS);
import_electron.contextBridge.exposeInMainWorld("openpi", {
  isNative: true,
  invoke(channel, args) {
    if (!allowedInvoke.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return import_electron.ipcRenderer.invoke(invokeChannelName(channel), args);
  },
  /** Subscribe to a push channel; returns the unsubscribe function. */
  on(channel, handler) {
    if (!allowedEvents.has(channel)) {
      throw new Error(`Blocked IPC event channel: ${channel}`);
    }
    const listener = (_event, payload) => handler(payload);
    const name = eventChannelName(channel);
    import_electron.ipcRenderer.on(name, listener);
    return () => import_electron.ipcRenderer.removeListener(name, listener);
  }
});
//# sourceMappingURL=preload.cjs.map
