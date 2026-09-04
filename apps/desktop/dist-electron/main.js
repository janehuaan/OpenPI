// electron/main.ts
import { existsSync as existsSync2, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname as dirname3, join as join3 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { app, BrowserWindow, ipcMain, nativeTheme, screen, shell as shell2 } from "electron";

// electron/daemon.ts
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";

// ../../packages/daemon/src/app-ops.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// ../../packages/daemon/src/config.ts
import { homedir } from "node:os";
import { dirname, join } from "node:path";
function openpiDir() {
  return process.env.OPENPI_DIR ?? join(homedir(), ".openpi");
}
function socketPath() {
  return process.env.OPENPI_SOCKET ?? join(openpiDir(), "daemon.sock");
}

// ../../packages/daemon/src/app-ops.ts
var execFileAsync = promisify(execFile);

// ../../packages/daemon/src/ipc/client.ts
import { randomUUID } from "node:crypto";
import { connect } from "node:net";

// ../../packages/shared/src/index.ts
function encodeMessage(message) {
  return `${JSON.stringify(message)}
`;
}
function decodeLines(buffer, chunk) {
  const combined = buffer + chunk;
  const parts = combined.split("\n");
  const rest = parts.pop() ?? "";
  const messages = [];
  const errors = [];
  for (const part of parts) {
    const line = part.trim();
    if (!line) continue;
    try {
      messages.push(JSON.parse(line));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { messages, rest, errors };
}

// ../../packages/daemon/src/ipc/client.ts
var DaemonClient = class {
  socket;
  buffer = "";
  pending = /* @__PURE__ */ new Map();
  eventHandlers = /* @__PURE__ */ new Set();
  connect(timeoutMs = 5e3) {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath());
      socket.setEncoding("utf8");
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("timed out connecting to daemon"));
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("data", (chunk) => this.handleChunk(chunk));
      socket.on("close", () => {
        for (const [, pending] of this.pending) pending.reject(new Error("daemon connection closed"));
        this.pending.clear();
        this.socket = void 0;
      });
    });
  }
  onEvent(handler) {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }
  request(request, timeoutMs = 13e4) {
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error("not connected"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`daemon request ${request.type} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        }
      });
      socket.write(encodeMessage({ ...request, id }));
    });
  }
  close() {
    this.socket?.end();
    this.socket = void 0;
  }
  handleChunk(chunk) {
    const { messages, rest } = decodeLines(this.buffer, chunk);
    this.buffer = rest;
    for (const raw of messages) {
      const message = raw;
      if (message.type === "event") {
        for (const handler of this.eventHandlers) handler(message.sessionId, message.event);
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.ok) pending.resolve(message.data);
      else pending.reject(new Error(message.error));
    }
  }
};
async function isDaemonLive() {
  const client2 = new DaemonClient();
  try {
    await client2.connect(1500);
    await client2.request({ type: "health" }, 3e3);
    client2.close();
    return true;
  } catch {
    client2.close();
    return false;
  }
}

// ../../packages/daemon/src/serve.ts
var startedAt = Date.now();

// electron/daemon.ts
function daemonCli() {
  const override = process.env.OPENPI_DAEMON_CLI;
  if (override) return override;
  const here2 = dirname2(fileURLToPath(import.meta.url));
  const candidates = [
    // dev: apps/desktop/dist-electron -> repo root
    join2(here2, "../../../packages/daemon/src/cli.ts"),
    // packaged: resources/openpi/packages/daemon/src/cli.ts
    join2(process.resourcesPath ?? "", "openpi/packages/daemon/src/cli.ts")
  ];
  const found = candidates.find(existsSync);
  if (found) return found;
  throw new Error(
    `openpi daemon CLI not found. Looked in:
  ${candidates.join("\n  ")}
Set OPENPI_DAEMON_CLI, or reinstall the app.`
  );
}
var client;
var deferredRestartNotice;
function onRestartDeferred(notify) {
  deferredRestartNotice = notify;
}
async function ensureDaemon() {
  if (client) return client;
  if (!await isDaemonLive()) await startDaemon();
  const connected = new DaemonClient();
  await connected.connect();
  client = connected;
  return connected;
}
function spawnDaemon() {
  const child = spawn(process.execPath, ["--experimental-strip-types", daemonCli(), "serve"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
  });
  child.unref();
}
async function startDaemon() {
  spawnDaemon();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await isDaemonLive()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("daemon did not start within 4s");
}
async function restartIfStale() {
  const connection = await ensureDaemon();
  const health = await connection.request({ type: "health" });
  let onDiskMtime = 0;
  try {
    onDiskMtime = statSync(health.cliPath).mtimeMs;
  } catch {
    return "current";
  }
  if (onDiskMtime === health.cliMtimeMs) return "current";
  if (health.runningCount > 0) {
    deferredRestartNotice?.();
    return "deferred";
  }
  await restartDaemon();
  return "restarted";
}
async function restartDaemon() {
  if (await isDaemonLive()) {
    const connection = client ?? new DaemonClient();
    if (!client) await connection.connect();
    await connection.request({ type: "shutdown" }).catch(() => void 0);
    connection.close();
    client = void 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!await isDaemonLive()) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await ensureDaemon();
}
function disconnect() {
  client?.close();
  client = void 0;
}

// electron/handlers.ts
import { dialog, shell } from "electron";

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
var CHANNEL_PREFIX = "openpi:";
function invokeChannelName(channel) {
  return `${CHANNEL_PREFIX}${channel}`;
}
function eventChannelName(channel) {
  return `${CHANNEL_PREFIX}${channel}`;
}

// electron/handlers.ts
var asString = (args, key) => {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${key} is required`);
  return value;
};
var asScope = (args) => args.scope === "global" ? "global" : "project";
function registerHandlers(ipcMain2, getWindow) {
  const send = (channel, payload) => {
    const window = getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(eventChannelName(channel), payload);
  };
  onRestartDeferred(() => send("daemon_status", { kind: "restart_deferred" }));
  const forward = async (request) => {
    const client2 = await ensureDaemon();
    return client2.request(request);
  };
  const app2 = (op) => forward({ type: "app", op });
  const handlers = {
    daemon_health: () => forward({ type: "health" }),
    daemon_start: async () => {
      await ensureDaemon();
      return { ok: true };
    },
    daemon_restart: async () => {
      await restartDaemon();
      return { ok: true };
    },
    list_sessions: () => forward({ type: "list_sessions" }),
    create_session: (args) => forward({
      type: "create_session",
      cwd: asString(args, "cwd"),
      mode: args.mode === "code" ? "code" : "chat",
      model: typeof args.model === "string" ? args.model : void 0,
      name: typeof args.name === "string" ? args.name : void 0
    }),
    stop_session: (args) => forward({ type: "stop_session", sessionId: asString(args, "sessionId") }),
    delete_session: (args) => forward({ type: "delete_session", sessionId: asString(args, "sessionId") }),
    subscribe_session: async (args) => {
      const client2 = await ensureDaemon();
      if (!subscribed) {
        client2.onEvent((sessionId, event) => send("session_event", { sessionId, event }));
        subscribed = true;
      }
      return client2.request({ type: "subscribe", sessionId: asString(args, "sessionId") });
    },
    unsubscribe_session: (args) => forward({ type: "unsubscribe", sessionId: asString(args, "sessionId") }),
    session_rpc: (args) => forward({
      type: "rpc",
      sessionId: asString(args, "sessionId"),
      command: args.command ?? {}
    }),
    auth_status: () => app2({ name: "auth_status" }),
    list_models: () => app2({ name: "list_models" }),
    import_credentials: () => app2({ name: "import_global_credentials" }),
    default_workspace: () => app2({ name: "default_workspace" }),
    recent_workspaces: () => app2({ name: "recent_workspaces" }),
    workspace_summary: (args) => app2({ name: "workspace_summary", cwd: asString(args, "cwd") }),
    list_memory: (args) => app2({ name: "list_memory", cwd: asString(args, "cwd"), scope: asScope(args) }),
    read_memory_topic: (args) => app2({
      name: "read_memory_topic",
      cwd: asString(args, "cwd"),
      scope: asScope(args),
      type: asString(args, "type"),
      key: asString(args, "key")
    }),
    write_memory: (args) => app2({
      name: "write_memory",
      cwd: asString(args, "cwd"),
      scope: asScope(args),
      type: asString(args, "type"),
      key: asString(args, "key"),
      value: asString(args, "value"),
      body: typeof args.body === "string" ? args.body : void 0
    }),
    delete_memory: (args) => app2({
      name: "delete_memory",
      cwd: asString(args, "cwd"),
      scope: asScope(args),
      type: asString(args, "type"),
      key: asString(args, "key")
    }),
    // Electron-only capabilities.
    select_workspace: async (args) => {
      const window = getWindow();
      const result = await dialog.showOpenDialog(window ?? void 0, {
        properties: ["openDirectory", "createDirectory"],
        defaultPath: typeof args.defaultPath === "string" ? args.defaultPath : void 0
      });
      return { cwd: result.canceled ? void 0 : result.filePaths[0] };
    },
    open_external: async (args) => {
      const url = asString(args, "url");
      if (!/^https?:\/\//i.test(url)) throw new Error("only http(s) URLs can be opened");
      await shell.openExternal(url);
      return { ok: true };
    },
    show_item_in_folder: async (args) => {
      shell.showItemInFolder(asString(args, "path"));
      return { ok: true };
    }
  };
  let subscribed = false;
  for (const channel of INVOKE_CHANNELS) {
    ipcMain2.handle(invokeChannelName(channel), async (_event, args = {}) => {
      return handlers[channel](args ?? {});
    });
  }
  void restartIfStale().catch(() => void 0);
}

// electron/main.ts
var here = dirname3(fileURLToPath2(import.meta.url));
var isDev = !app.isPackaged && process.env.OPENPI_DESKTOP_PROD !== "1";
var DEV_URL = "http://127.0.0.1:5179";
var mainWindow;
var DEFAULT_STATE = { width: 1400, height: 900 };
var MIN_WIDTH = 900;
var MIN_HEIGHT = 600;
var backgroundColor = () => nativeTheme.shouldUseDarkColors ? "#0b0d11" : "#eceff4";
function statePath() {
  const dir = join3(app.getPath("userData"), "window-state");
  if (!existsSync2(dir)) mkdirSync(dir, { recursive: true });
  return join3(dir, "state.json");
}
function loadState() {
  try {
    const file = statePath();
    if (!existsSync2(file)) return void 0;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed.width !== "number" || typeof parsed.height !== "number") return void 0;
    if (parsed.width < MIN_WIDTH || parsed.height < MIN_HEIGHT) return void 0;
    return parsed;
  } catch {
    return void 0;
  }
}
function saveState(window) {
  try {
    const bounds = window.getBounds();
    writeFileSync(statePath(), JSON.stringify(bounds), "utf8");
  } catch {
  }
}
function fitToDisplay(state) {
  const hasPosition = typeof state.x === "number" && typeof state.y === "number";
  const display = hasPosition ? screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width, height: state.height }) : screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(Math.max(state.width, MIN_WIDTH), area.width);
  const height = Math.min(Math.max(state.height, MIN_HEIGHT), area.height);
  const wantedX = hasPosition ? state.x : area.x + Math.round((area.width - width) / 2);
  const wantedY = hasPosition ? state.y : area.y + Math.round((area.height - height) / 2);
  return {
    width,
    height,
    x: Math.min(Math.max(wantedX, area.x), area.x + area.width - width),
    y: Math.min(Math.max(wantedY, area.y), area.y + area.height - height)
  };
}
function resolveIcon() {
  const candidates = [
    join3(here, "../build/icon.icns"),
    join3(here, "../build/icon.png"),
    join3(process.resourcesPath ?? "", "icon.icns")
  ];
  return candidates.find((candidate) => candidate && existsSync2(candidate));
}
function createWindow() {
  const icon = resolveIcon();
  const window = new BrowserWindow({
    ...fitToDisplay(loadState() ?? DEFAULT_STATE),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: "OpenPI",
    backgroundColor: backgroundColor(),
    ...icon ? { icon } : {},
    webPreferences: {
      preload: join3(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;
  const persist = () => saveState(window);
  window.on("resize", persist);
  window.on("move", persist);
  window.on("close", persist);
  window.on("closed", () => {
    mainWindow = void 0;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell2.openExternal(url);
    return { action: "deny" };
  });
  if (isDev) {
    void window.loadURL(DEV_URL);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(join3(here, "../dist/index.html"));
  }
}
app.whenReady().then(() => {
  registerHandlers(ipcMain, () => mainWindow);
  nativeTheme.on("updated", () => mainWindow?.setBackgroundColor(backgroundColor()));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  disconnect();
  if (process.platform !== "darwin") app.quit();
});
//# sourceMappingURL=main.js.map
