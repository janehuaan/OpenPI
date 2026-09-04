// electron/main.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync4, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname5, join as join6 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
import { app, BrowserWindow, ipcMain, nativeTheme, screen, shell as shell2 } from "electron";

// electron/daemon.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync3, statSync as statSync3 } from "node:fs";
import { dirname as dirname4, join as join5 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

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
    return new Promise((resolve2, reject) => {
      const socket = connect(socketPath());
      socket.setEncoding("utf8");
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("timed out connecting to daemon"));
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve2();
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
    return new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`daemon request ${request.type} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve2(value);
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

// ../../packages/scheduler/src/config.ts
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var VERSION = "0.1.0";
function schedulerDir() {
  const explicit = process.env.OPENPI_SCHEDULER_DIR;
  if (explicit) return explicit;
  const home = process.env.OPENPI_DIR ?? join2(homedir2(), ".openpi");
  return join2(home, "scheduler");
}
function tasksPath() {
  return join2(schedulerDir(), "tasks.json");
}
function runsPath() {
  return join2(schedulerDir(), "task-runs.json");
}
function stepRunsPath() {
  return join2(schedulerDir(), "step-runs.json");
}
function taskLogsDir() {
  return join2(schedulerDir(), "task-logs");
}
function taskSessionsDir() {
  return join2(schedulerDir(), "sessions");
}

// ../../packages/scheduler/src/task-retry.ts
var DEFAULT_BACKOFF_MS = 1e3;
var DEFAULT_BACKOFF_MULTIPLIER = 2;
var DEFAULT_MAX_BACKOFF_MS = 6e4;
function normalizeRetryPolicy(retry) {
  if (!retry) return void 0;
  const maxAttempts = Math.max(0, Math.floor(retry.maxAttempts));
  if (maxAttempts <= 0) return void 0;
  return {
    maxAttempts,
    backoffMs: retry.backoffMs === void 0 ? DEFAULT_BACKOFF_MS : Math.max(0, retry.backoffMs),
    backoffMultiplier: retry.backoffMultiplier === void 0 ? DEFAULT_BACKOFF_MULTIPLIER : Math.max(1, retry.backoffMultiplier),
    maxBackoffMs: retry.maxBackoffMs === void 0 ? DEFAULT_MAX_BACKOFF_MS : Math.max(0, retry.maxBackoffMs),
    retryOn: retry.retryOn && retry.retryOn.length > 0 ? [...retry.retryOn] : ["failed"]
  };
}
function computeBackoffMs(policy, failedAttempt) {
  const base = policy.backoffMs ?? DEFAULT_BACKOFF_MS;
  const multiplier = policy.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  const max = policy.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const exponent = Math.max(0, failedAttempt - 1);
  const delay = base * multiplier ** exponent;
  return Math.min(max, Math.floor(delay));
}
function shouldRetryRun(task, run, status = run.status) {
  const policy = normalizeRetryPolicy(task.retry);
  if (!policy) return false;
  const attempt = run.attempt ?? 1;
  if (attempt > policy.maxAttempts) return false;
  const retryOn = policy.retryOn ?? ["failed"];
  if (status === "failed" && retryOn.includes("failed")) return true;
  if (status === "interrupted" && retryOn.includes("interrupted")) return true;
  return false;
}

// ../../packages/scheduler/src/task-schedule.ts
function parseNumber(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`Invalid ${label}: ${value}`);
  return number;
}
function matchesField(field, value, minimum, maximum, label) {
  if (field === "*") return true;
  if (field.startsWith("*/")) return value % parseNumber(field.slice(2), 1, maximum, label) === 0;
  return field.split(",").some((part) => {
    if (part.includes("-")) {
      const [start, end] = part.split("-");
      return value >= parseNumber(start, minimum, maximum, label) && value <= parseNumber(end, minimum, maximum, label);
    }
    return value === parseNumber(part, minimum, maximum, label);
  });
}
function utcParts(date) {
  return {
    minute: date.getUTCMinutes(),
    hour: date.getUTCHours(),
    dayOfMonth: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    dayOfWeek: date.getUTCDay()
  };
}
function wallClockParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const read = (type) => {
    const part = parts.find((entry) => entry.type === type);
    if (!part) throw new Error(`Unable to resolve ${type} for timezone ${timezone}.`);
    return part.value;
  };
  const weekday = read("weekday").toLowerCase();
  const weekdayMap = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6
  };
  const dayOfWeek = weekdayMap[weekday.slice(0, 3)];
  if (dayOfWeek === void 0) throw new Error(`Unable to resolve weekday for timezone ${timezone}.`);
  return {
    minute: Number(read("minute")),
    hour: Number(read("hour")),
    dayOfMonth: Number(read("day")),
    month: Number(read("month")),
    dayOfWeek
  };
}
function assertValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat(void 0, { timeZone: timezone });
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}
function nextRunForSchedule(schedule, after) {
  if (schedule.kind === "once") {
    const timestamp = Date.parse(schedule.runAt);
    if (!Number.isFinite(timestamp)) throw new Error(`Invalid runAt: ${schedule.runAt}`);
    return new Date(timestamp).toISOString();
  }
  const timezone = schedule.timezone && schedule.timezone !== "UTC" ? schedule.timezone : void 0;
  if (timezone) assertValidTimezone(timezone);
  const fields = schedule.expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Cron expression must contain five fields.");
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const candidate = new Date(after.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  const limit = candidate.getTime() + 366 * 24 * 60 * 60 * 1e3;
  while (candidate.getTime() <= limit) {
    const parts = timezone ? wallClockParts(candidate, timezone) : utcParts(candidate);
    if (matchesField(minute, parts.minute, 0, 59, "minute") && matchesField(hour, parts.hour, 0, 23, "hour") && matchesField(dayOfMonth, parts.dayOfMonth, 1, 31, "day of month") && matchesField(month, parts.month, 1, 12, "month") && matchesField(dayOfWeek, parts.dayOfWeek, 0, 6, "day of week")) {
      return candidate.toISOString();
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw new Error("Cron expression has no matching time within one year.");
}

// ../../packages/scheduler/src/task-executor.ts
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { dirname as dirname2, join as join3, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var DEFAULT_FORCE_KILL_MS = 5e3;
var DEFAULT_SAFE_TOOLS = ["read", "grep", "find", "ls", "bash"];
function resolvePiEntry() {
  const configured = process.env.OPENPI_PI_CLI;
  if (configured) return resolve(configured);
  const here2 = dirname2(fileURLToPath(import.meta.url));
  const candidates = [
    join3(here2, "../../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
    join3(here2, "../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js")
  ];
  const found = candidates.find(existsSync);
  if (found) return found;
  throw new Error(
    `pi CLI not found. Looked in:
  ${candidates.join("\n  ")}
Run \`npm install\` at the repo root, or set OPENPI_PI_CLI.`
  );
}
function forceKillMs() {
  const configured = Number(process.env.PI_TASK_FORCE_KILL_MS);
  if (Number.isFinite(configured) && configured >= 0) return configured;
  return DEFAULT_FORCE_KILL_MS;
}
function signalProcess(pid, signal) {
  try {
    if (process.platform === "win32") {
      if (signal === "SIGKILL") {
        spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
        return;
      }
      process.kill(pid, signal);
      return;
    }
    process.kill(-pid, signal);
  } catch {
  }
}
function stopProcess(pid, forceTimer) {
  if (!pid) return;
  signalProcess(pid, "SIGTERM");
  const delay = forceKillMs();
  if (delay <= 0) {
    signalProcess(pid, "SIGKILL");
    return;
  }
  forceTimer.current = setTimeout(() => {
    signalProcess(pid, "SIGKILL");
  }, delay);
  forceTimer.current.unref?.();
}
function loadTaskDefaults() {
  try {
    const agentDir3 = process.env.PI_CODING_AGENT_DIR ?? join3(process.env.OPENPI_DIR ?? join3(homedir3(), ".openpi"), "agent");
    const path = join3(agentDir3, "openpi.json");
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}
function buildArgs(task, run, sessionDir) {
  const defaults = loadTaskDefaults();
  const args = [resolvePiEntry()];
  if (task.provider) args.push("--provider", task.provider);
  if (task.model) args.push("--model", task.model);
  const tools = task.tools && task.tools.length > 0 ? task.tools : defaults.defaultTaskTools ?? DEFAULT_SAFE_TOOLS;
  if (tools.length > 0) args.push("--tools", tools.join(","));
  if (task.excludeTools && task.excludeTools.length > 0) {
    args.push("--exclude-tools", task.excludeTools.join(","));
  }
  const extensions = [...task.extensions ?? [], ...defaults.defaultTaskExtensions ?? []];
  for (const extension of extensions) {
    args.push("--extension", extension);
  }
  args.push("--session-dir", sessionDir);
  args.push("--session-id", run.id);
  args.push("--print", task.prompt);
  return args;
}
function findSessionFile(sessionDir, sessionId) {
  if (!existsSync(sessionDir)) return void 0;
  const candidates = [];
  for (const name of readdirSync(sessionDir)) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join3(sessionDir, name);
    try {
      const stat = statSync(path);
      if (!stat.isFile()) continue;
      candidates.push({ path, mtime: stat.mtimeMs });
    } catch {
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const candidate of candidates) {
    try {
      const firstLine = readFileSync(candidate.path, "utf8").split("\n").find((line) => line.trim().length > 0);
      if (!firstLine) continue;
      const header = JSON.parse(firstLine);
      const id = header.id ?? header.sessionId;
      if (id === sessionId || candidate.path.includes(sessionId)) {
        return { sessionId: id ?? sessionId, sessionFile: candidate.path };
      }
    } catch {
    }
  }
  if (candidates[0]) {
    return { sessionId, sessionFile: candidates[0].path };
  }
  return void 0;
}
var ProcessTaskExecutor = class {
  execute(task, run) {
    const cwd = task.cwd ?? process.cwd();
    if (!existsSync(cwd)) throw new Error(`Task working directory does not exist: ${cwd}`);
    const logsDir = taskLogsDir();
    mkdirSync(logsDir, { recursive: true });
    const sessionDir = join3(taskSessionsDir(), run.id);
    mkdirSync(sessionDir, { recursive: true });
    const stdoutPath = join3(logsDir, `${run.id}.stdout.log`);
    const stderrPath = join3(logsDir, `${run.id}.stderr.log`);
    const stdout = openSync(stdoutPath, "a", 384);
    const stderr = openSync(stderrPath, "a", 384);
    const env = { ...process.env, ...task.env ?? {} };
    const piArgs = buildArgs(task, run, sessionDir);
    const useDocker = task.sandbox === "docker";
    const child = useDocker ? spawn(
      "docker",
      [
        "run",
        "--rm",
        "-v",
        `${cwd}:/work`,
        "-w",
        "/work",
        task.dockerImage ?? "node:22-bookworm",
        process.execPath,
        ...piArgs
      ],
      {
        cwd,
        detached: process.platform !== "win32",
        env,
        stdio: ["ignore", stdout, stderr]
      }
    ) : spawn(process.execPath, piArgs, {
      cwd,
      detached: process.platform !== "win32",
      env,
      stdio: ["ignore", stdout, stderr]
    });
    const forceTimer = {};
    const completion = new Promise((resolveResult, reject) => {
      child.once("error", reject);
      child.once("close", (code) => {
        if (forceTimer.current) clearTimeout(forceTimer.current);
        const session = findSessionFile(sessionDir, run.id);
        resolveResult({
          exitCode: code ?? 1,
          result: "",
          error: "",
          pid: child.pid,
          sessionId: session?.sessionId,
          sessionFile: session?.sessionFile
        });
      });
    });
    return {
      pid: child.pid,
      stdoutPath,
      stderrPath,
      sessionDir,
      completion,
      cancel: () => stopProcess(child.pid, forceTimer)
    };
  }
};

// ../../packages/scheduler/src/task-scheduler.ts
import { readFileSync as readFileSync3, statSync as statSync2 } from "node:fs";

// ../../packages/scheduler/src/task-store.ts
import { randomUUID as randomUUID2 } from "node:crypto";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync, writeFileSync } from "node:fs";
import { dirname as dirname3 } from "node:path";
var TASK_SCHEMA_VERSION = 1;
function atomicWrite(path, content) {
  mkdirSync2(dirname3(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID2()}.tmp`;
  writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 384 });
  renameSync(temporaryPath, path);
}
function readJson(path) {
  if (!existsSync2(path)) return void 0;
  const raw = readFileSync2(path, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    const quarantine = `${path}.corrupt.${Date.now()}`;
    try {
      renameSync(path, quarantine);
      process.stderr.write(
        `[scheduler] ${path} did not parse (${String(error)}); moved to ${quarantine}
`
      );
    } catch {
    }
    return void 0;
  }
}
function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}
function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}
function optionalString(value, label) {
  if (value === void 0) return void 0;
  return requireString(value, label);
}
function optionalStringArray(value, label) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new Error(`${label} must be an array of non-empty strings.`);
  }
  return value;
}
function optionalStringRecord(value, label) {
  if (value === void 0) return void 0;
  const object = requireObject(value, label);
  const result = {};
  for (const [key, entry] of Object.entries(object)) {
    if (typeof entry !== "string") throw new Error(`${label}.${key} must be a string.`);
    result[key] = entry;
  }
  return result;
}
function parseSchedule(value) {
  const schedule = requireObject(value, "task schedule");
  if (schedule.kind === "once") return { kind: "once", runAt: requireString(schedule.runAt, "runAt") };
  if (schedule.kind === "cron") {
    return {
      kind: "cron",
      expression: requireString(schedule.expression, "cron expression"),
      timezone: schedule.timezone === void 0 ? void 0 : requireString(schedule.timezone, "timezone")
    };
  }
  throw new Error("Task schedule kind must be once or cron.");
}
function parseRetry(value) {
  if (value === void 0) return void 0;
  const retry = requireObject(value, "task retry");
  if (typeof retry.maxAttempts !== "number" || !Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 0) {
    throw new Error("retry.maxAttempts must be a non-negative integer.");
  }
  const retryOn = retry.retryOn === void 0 ? void 0 : (() => {
    if (!Array.isArray(retry.retryOn)) throw new Error("retry.retryOn must be an array.");
    const allowed = ["failed", "interrupted"];
    for (const entry of retry.retryOn) {
      if (!allowed.includes(entry)) {
        throw new Error("retry.retryOn entries must be failed or interrupted.");
      }
    }
    return retry.retryOn;
  })();
  return normalizeRetryPolicy({
    maxAttempts: typeof retry.maxAttempts === "number" ? retry.maxAttempts : 0,
    backoffMs: typeof retry.backoffMs === "number" ? retry.backoffMs : void 0,
    backoffMultiplier: typeof retry.backoffMultiplier === "number" ? Math.max(1, retry.backoffMultiplier) : void 0,
    maxBackoffMs: typeof retry.maxBackoffMs === "number" ? retry.maxBackoffMs : void 0,
    retryOn
  });
}
function parseStepDefinition(value) {
  const step = requireObject(value, "task step");
  const id = requireString(step.id, "step id");
  const dependsOn = optionalStringArray(step.dependsOn, "step.dependsOn");
  const skipIfFailed = optionalStringArray(step.skipIfFailed, "step.skipIfFailed");
  const skipIfSkipped = optionalStringArray(step.skipIfSkipped, "step.skipIfSkipped");
  const maxAttempts = typeof step.maxAttempts === "number" ? step.maxAttempts : 0;
  const retry = step.retry !== void 0 ? parseRetry(step.retry) : void 0;
  return {
    id,
    title: requireString(step.title, "step title"),
    prompt: requireString(step.prompt, "step prompt"),
    tools: optionalStringArray(step.tools, "step.tools"),
    dependsOn: dependsOn ?? [],
    skipIfFailed: skipIfFailed ?? [],
    skipIfSkipped: skipIfSkipped ?? [],
    maxAttempts,
    retry
  };
}
function parseSteps(value) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) throw new Error("steps must be an array");
  return value.map((entry) => parseStepDefinition(entry));
}
function parseTask(value) {
  const task = requireObject(value, "task");
  if (task.status !== "active" && task.status !== "paused") throw new Error("Task status must be active or paused.");
  return {
    id: requireString(task.id, "task id"),
    title: requireString(task.title, "task title"),
    prompt: requireString(task.prompt, "task prompt"),
    cwd: optionalString(task.cwd, "task cwd"),
    schedule: parseSchedule(task.schedule),
    status: task.status,
    createdAt: requireString(task.createdAt, "task createdAt"),
    updatedAt: requireString(task.updatedAt, "task updatedAt"),
    nextRunAt: optionalString(task.nextRunAt, "task nextRunAt"),
    retry: parseRetry(task.retry),
    provider: optionalString(task.provider, "task provider"),
    model: optionalString(task.model, "task model"),
    tools: optionalStringArray(task.tools, "task tools"),
    excludeTools: optionalStringArray(task.excludeTools, "task excludeTools"),
    env: optionalStringRecord(task.env, "task env"),
    extensions: optionalStringArray(task.extensions, "task extensions"),
    securityMode: task.securityMode === "strict" || task.securityMode === "confirm" || task.securityMode === "permissive" ? task.securityMode : void 0,
    sandbox: task.sandbox === "docker" || task.sandbox === "none" ? task.sandbox : void 0,
    dockerImage: optionalString(task.dockerImage, "task dockerImage"),
    steps: parseSteps(task.steps),
    maxConcurrentSteps: typeof task.maxConcurrentSteps === "number" ? task.maxConcurrentSteps : void 0,
    maxConcurrentRuns: typeof task.maxConcurrentRuns === "number" ? task.maxConcurrentRuns : void 0
  };
}
function parseStepRun(value) {
  const step = requireObject(value, "step run");
  const statuses = ["pending", "running", "succeeded", "failed", "cancelled", "skipped"];
  if (!statuses.includes(step.status)) throw new Error("Invalid step run status.");
  const trigger = step.trigger === "scheduled" ? "scheduled" : step.trigger === "retry" ? "retry" : "manual";
  return {
    id: requireString(step.id, "step run id"),
    runId: requireString(step.runId, "step run runId"),
    stepId: requireString(step.stepId, "step run stepId"),
    stepTitle: requireString(step.stepTitle, "step run stepTitle"),
    status: step.status,
    trigger,
    attempt: typeof step.attempt === "number" ? step.attempt : 1,
    createdAt: requireString(step.createdAt, "step run createdAt"),
    startedAt: optionalString(step.startedAt, "step run startedAt"),
    finishedAt: optionalString(step.finishedAt, "step run finishedAt"),
    pid: typeof step.pid === "number" ? step.pid : void 0,
    exitCode: typeof step.exitCode === "number" ? step.exitCode : void 0,
    result: typeof step.result === "string" ? step.result : void 0,
    error: typeof step.error === "string" ? step.error : void 0,
    stdoutPath: typeof step.stdoutPath === "string" ? step.stdoutPath : void 0,
    stderrPath: typeof step.stderrPath === "string" ? step.stderrPath : void 0,
    sessionId: optionalString(step.sessionId, "step run sessionId"),
    sessionFile: optionalString(step.sessionFile, "step run sessionFile")
  };
}
function parseStepRuns(value) {
  if (value === void 0) return void 0;
  if (!Array.isArray(value)) throw new Error("stepRuns must be an array");
  return value.map((entry) => parseStepRun(entry));
}
function parseRun(value) {
  const run = requireObject(value, "task run");
  const statuses = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"];
  if (!statuses.includes(run.status)) throw new Error("Invalid task run status.");
  const trigger = run.trigger === "scheduled" ? "scheduled" : run.trigger === "retry" ? "retry" : "manual";
  return {
    id: requireString(run.id, "run id"),
    taskId: requireString(run.taskId, "run taskId"),
    status: run.status,
    trigger,
    createdAt: requireString(run.createdAt, "run createdAt"),
    startedAt: optionalString(run.startedAt, "run startedAt"),
    finishedAt: optionalString(run.finishedAt, "run finishedAt"),
    pid: typeof run.pid === "number" ? run.pid : void 0,
    exitCode: typeof run.exitCode === "number" ? run.exitCode : void 0,
    result: typeof run.result === "string" ? run.result : void 0,
    error: typeof run.error === "string" ? run.error : void 0,
    stdoutPath: typeof run.stdoutPath === "string" ? run.stdoutPath : void 0,
    stderrPath: typeof run.stderrPath === "string" ? run.stderrPath : void 0,
    attempt: typeof run.attempt === "number" ? run.attempt : void 0,
    parentRunId: optionalString(run.parentRunId, "run parentRunId"),
    sessionId: optionalString(run.sessionId, "run sessionId"),
    sessionFile: optionalString(run.sessionFile, "run sessionFile"),
    stepRuns: parseStepRuns(run.stepRuns)
  };
}
function parseFile(value, key, parser) {
  if (value === void 0) return [];
  const file = requireObject(value, `${key} file`);
  if (file.schemaVersion !== TASK_SCHEMA_VERSION) throw new Error(`Unsupported ${key} schema version.`);
  if (!Array.isArray(file[key])) throw new Error(`${key} must be an array.`);
  return file[key].map(parser);
}
function parseStepRunFile(value) {
  if (value === void 0) return [];
  const file = requireObject(value, "step runs file");
  if (file.schemaVersion !== TASK_SCHEMA_VERSION) throw new Error("Unsupported step runs schema version.");
  if (!Array.isArray(file.stepRuns)) throw new Error("stepRuns must be an array.");
  return file.stepRuns.map(parseStepRun);
}
var TaskStore = class {
  loadTasks() {
    return parseFile(readJson(tasksPath()), "tasks", parseTask);
  }
  saveTasks(tasks) {
    const file = { schemaVersion: TASK_SCHEMA_VERSION, tasks };
    atomicWrite(tasksPath(), `${JSON.stringify(file, null, 2)}
`);
  }
  loadRuns() {
    return parseFile(readJson(runsPath()), "runs", parseRun);
  }
  saveRuns(runs) {
    const file = { schemaVersion: TASK_SCHEMA_VERSION, runs };
    atomicWrite(runsPath(), `${JSON.stringify(file, null, 2)}
`);
  }
  loadStepRuns() {
    return parseStepRunFile(readJson(stepRunsPath()));
  }
  saveStepRuns(stepRuns2) {
    const file = { schemaVersion: TASK_SCHEMA_VERSION, stepRuns: stepRuns2 };
    atomicWrite(stepRunsPath(), `${JSON.stringify(file, null, 2)}
`);
  }
  createTask(input, nextRunAt) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const task = {
      id: randomUUID2(),
      title: input.title,
      prompt: input.prompt,
      cwd: input.cwd,
      schedule: input.schedule,
      status: "active",
      createdAt: now,
      updatedAt: now,
      nextRunAt,
      retry: normalizeRetryPolicy(input.retry),
      provider: input.provider,
      model: input.model,
      tools: input.tools,
      excludeTools: input.excludeTools,
      env: input.env,
      extensions: input.extensions,
      securityMode: input.securityMode,
      sandbox: input.sandbox,
      dockerImage: input.dockerImage,
      steps: input.steps,
      maxConcurrentSteps: input.maxConcurrentSteps,
      maxConcurrentRuns: input.maxConcurrentRuns
    };
    const tasks = this.loadTasks();
    tasks.push(task);
    this.saveTasks(tasks);
    return task;
  }
  getTask(taskId) {
    return this.loadTasks().find((task) => task.id === taskId);
  }
  updateTask(taskId, update) {
    const tasks = this.loadTasks();
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index === -1) return void 0;
    tasks[index] = update(tasks[index]);
    this.saveTasks(tasks);
    return tasks[index];
  }
  deleteTask(taskId) {
    const tasks = this.loadTasks();
    const filtered = tasks.filter((task) => task.id !== taskId);
    if (filtered.length === tasks.length) return false;
    this.saveTasks(filtered);
    return true;
  }
  createRun(taskId, trigger, options = {}) {
    const run = {
      id: randomUUID2(),
      taskId,
      status: "queued",
      trigger: options.trigger ?? trigger,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      attempt: options.attempt ?? 1,
      parentRunId: options.parentRunId
    };
    const runs = this.loadRuns();
    runs.push(run);
    this.saveRuns(runs);
    return run;
  }
  updateRun(runId, update) {
    const runs = this.loadRuns();
    const index = runs.findIndex((run) => run.id === runId);
    if (index === -1) return void 0;
    runs[index] = update(runs[index]);
    this.saveRuns(runs);
    return runs[index];
  }
  markInterruptedRuns(now = (/* @__PURE__ */ new Date()).toISOString()) {
    const runs = this.loadRuns();
    const interrupted = [];
    let changed = false;
    for (const run of runs) {
      if (run.status !== "queued" && run.status !== "running") continue;
      run.status = "interrupted";
      run.finishedAt = now;
      run.error = "Orchestrator restarted before the run completed.";
      interrupted.push(run);
      changed = true;
    }
    if (changed) this.saveRuns(runs);
    return interrupted;
  }
  createStepRun(runId, stepId, stepTitle, trigger, attempt) {
    const stepRun = {
      id: randomUUID2(),
      runId,
      stepId,
      stepTitle,
      status: "pending",
      trigger,
      attempt,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const stepRuns2 = this.loadStepRuns();
    stepRuns2.push(stepRun);
    this.saveStepRuns(stepRuns2);
    return stepRun;
  }
  updateStepRun(stepRunId, update) {
    const stepRuns2 = this.loadStepRuns();
    const index = stepRuns2.findIndex((sr) => sr.id === stepRunId);
    if (index === -1) return void 0;
    stepRuns2[index] = update(stepRuns2[index]);
    this.saveStepRuns(stepRuns2);
    return stepRuns2[index];
  }
  markInterruptedStepRuns(now = (/* @__PURE__ */ new Date()).toISOString()) {
    const stepRuns2 = this.loadStepRuns();
    const interrupted = [];
    let changed = false;
    for (const stepRun of stepRuns2) {
      if (stepRun.status !== "pending" && stepRun.status !== "running") continue;
      stepRun.status = "cancelled";
      stepRun.finishedAt = now;
      stepRun.error = "Orchestrator restarted before the step run completed.";
      interrupted.push(stepRun);
      changed = true;
    }
    if (changed) this.saveStepRuns(stepRuns2);
    return interrupted;
  }
  loadStepRunsByRunId(runId) {
    return this.loadStepRuns().filter((sr) => sr.runId === runId);
  }
};
var taskStore = new TaskStore();

// ../../packages/scheduler/src/task-scheduler.ts
function readLog(path) {
  if (!path) return "";
  try {
    return readFileSync3(path, "utf8").trim();
  } catch {
    return "";
  }
}
function getReadySteps(steps, completed, skipped, failed, running) {
  const ready = [];
  for (const step of steps) {
    if (completed.has(step.id) || skipped.has(step.id) || failed.has(step.id)) continue;
    if (running.has(step.id)) continue;
    const depsSatisfied = (step.dependsOn ?? []).every((depId) => completed.has(depId));
    if (!depsSatisfied) continue;
    const skipIfFailed = (step.skipIfFailed ?? []).some((id) => failed.has(id));
    if (skipIfFailed) {
      ready.push(step);
      continue;
    }
    const skipIfSkipped = (step.skipIfSkipped ?? []).some((id) => skipped.has(id));
    if (skipIfSkipped) {
      ready.push(step);
      continue;
    }
    ready.push(step);
  }
  return ready;
}
var TaskScheduler = class {
  activeRuns = /* @__PURE__ */ new Map();
  pendingRetries = /* @__PURE__ */ new Map();
  store;
  executor;
  now;
  timer;
  startedAt;
  maxConcurrentTasks;
  activeTaskCount = 0;
  constructor(store = taskStore, executor = new ProcessTaskExecutor(), now = () => /* @__PURE__ */ new Date(), maxConcurrentTasks = 4) {
    this.store = store;
    this.executor = executor;
    this.now = now;
    this.maxConcurrentTasks = maxConcurrentTasks;
  }
  start(intervalMs = 15e3) {
    if (this.timer) return;
    this.startedAt = this.now().toISOString();
    const interruptedRuns = this.store.markInterruptedRuns(this.now().toISOString());
    this.store.markInterruptedStepRuns(this.now().toISOString());
    this.requeueInterrupted(interruptedRuns);
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = void 0;
    }
    for (const pending of this.pendingRetries.values()) clearTimeout(pending.timer);
    this.pendingRetries.clear();
  }
  health() {
    const tasks = this.store.loadTasks();
    const runs = this.store.loadRuns();
    const stepRuns2 = this.store.loadStepRuns();
    const startedAt2 = this.startedAt ?? this.now().toISOString();
    return {
      ok: true,
      version: VERSION,
      uptimeMs: Math.max(0, this.now().getTime() - Date.parse(startedAt2)),
      tasksActive: tasks.filter((task) => task.status === "active").length,
      tasksPaused: tasks.filter((task) => task.status === "paused").length,
      runsRunning: runs.filter((run) => run.status === "running").length + this.activeRuns.size,
      runsQueued: runs.filter((run) => run.status === "queued").length,
      startedAt: startedAt2,
      cliMtime: cliEntryMtime(),
      stepRunsRunning: stepRuns2.filter((sr) => sr.status === "running").length,
      stepRunsQueued: stepRuns2.filter((sr) => sr.status === "pending").length
    };
  }
  createTask(input) {
    if (!input.title.trim() || !input.prompt.trim()) throw new Error("Task title and prompt are required.");
    const nextRunAt = nextRunForSchedule(input.schedule, this.now());
    return this.store.createTask(
      {
        ...input,
        retry: normalizeRetryPolicy(input.retry)
      },
      nextRunAt
    );
  }
  listTasks() {
    return this.store.loadTasks();
  }
  getTask(taskId) {
    return this.store.getTask(taskId);
  }
  listRuns(taskId) {
    const runs = this.store.loadRuns();
    return taskId ? runs.filter((run) => run.taskId === taskId) : runs;
  }
  getRun(runId) {
    return this.store.loadRuns().find((run) => run.id === runId);
  }
  getStepRuns(runId) {
    return this.store.loadStepRunsByRunId(runId);
  }
  setPaused(taskId, paused) {
    if (paused) this.clearPendingRetry(taskId);
    return this.store.updateTask(taskId, (task) => ({
      ...task,
      status: paused ? "paused" : "active",
      updatedAt: this.now().toISOString()
    }));
  }
  deleteTask(taskId) {
    if (this.activeRuns.has(taskId)) throw new Error("Cannot delete a running task.");
    this.clearPendingRetry(taskId);
    return this.store.deleteTask(taskId);
  }
  cancel(runId) {
    const current = this.getRun(runId);
    if (!current) return void 0;
    if (current.status !== "queued" && current.status !== "running") return current;
    const active = this.activeRuns.get(current.taskId);
    if (active?.runId === runId) {
      active.cancelled = true;
      active.cancel();
    }
    this.clearPendingRetry(current.taskId);
    return this.store.updateRun(runId, (run) => ({
      ...run,
      status: "cancelled",
      finishedAt: this.now().toISOString(),
      error: "Cancelled by user."
    }));
  }
  async trigger(taskId, trigger = "manual", options = {}) {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    if (this.activeTaskCount >= this.maxConcurrentTasks) {
      throw new Error(`Global concurrency limit reached (${this.maxConcurrentTasks}).`);
    }
    if (task.maxConcurrentRuns && this.activeRuns.size >= task.maxConcurrentRuns) {
      throw new Error(`Task concurrency limit reached (${task.maxConcurrentRuns}).`);
    }
    const attempt = options.attempt ?? 1;
    const run = this.store.createRun(taskId, trigger, {
      attempt,
      parentRunId: options.parentRunId,
      trigger
    });
    this.activeTaskCount++;
    try {
      if (task.steps && task.steps.length > 0) {
        return await this.executeStepTask(task, run, trigger);
      }
      return await this.executeSingleStepTask(task, run);
    } finally {
      this.activeTaskCount--;
    }
  }
  async executeSingleStepTask(task, run) {
    try {
      const execution = this.executor.execute(task, run);
      const active = { runId: run.id, cancel: () => execution.cancel(), cancelled: false };
      this.activeRuns.set(task.id, active);
      run = this.store.updateRun(run.id, (current) => ({
        ...current,
        status: "running",
        startedAt: this.now().toISOString(),
        pid: execution.pid,
        stdoutPath: execution.stdoutPath,
        stderrPath: execution.stderrPath
      })) ?? run;
      const result = await execution.completion;
      if (active.cancelled) return this.getRun(run.id) ?? run;
      run = this.store.updateRun(run.id, (current) => ({
        ...current,
        status: result.exitCode === 0 ? "succeeded" : "failed",
        finishedAt: this.now().toISOString(),
        pid: result.pid ?? current.pid,
        exitCode: result.exitCode,
        result: result.result || readLog(current.stdoutPath),
        error: result.exitCode === 0 ? void 0 : result.error || readLog(current.stderrPath) || `Pi exited with code ${result.exitCode}.`,
        sessionId: result.sessionId ?? current.sessionId,
        sessionFile: result.sessionFile ?? current.sessionFile
      })) ?? run;
      if (run.status === "failed") this.maybeScheduleRetry(task, run);
      return run;
    } catch (error) {
      run = this.store.updateRun(run.id, (current) => ({
        ...current,
        status: "failed",
        finishedAt: this.now().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      })) ?? run;
      this.maybeScheduleRetry(task, run);
      return run;
    } finally {
      this.activeRuns.delete(task.id);
    }
  }
  async executeStepTask(task, run, trigger) {
    const steps = task.steps;
    const maxConcurrent = task.maxConcurrentSteps ?? 1;
    const completed = /* @__PURE__ */ new Set();
    const skipped = /* @__PURE__ */ new Set();
    const failed = /* @__PURE__ */ new Set();
    const running = /* @__PURE__ */ new Set();
    const activeSteps = /* @__PURE__ */ new Map();
    try {
      const active = {
        runId: run.id,
        cancel: () => {
          for (const entry of activeSteps.values()) {
            entry.cancelled = true;
            entry.execution.cancel();
          }
        },
        cancelled: false
      };
      this.activeRuns.set(task.id, active);
      run = this.store.updateRun(run.id, (current) => ({
        ...current,
        status: "running",
        startedAt: this.now().toISOString()
      })) ?? run;
      const existingStepRuns = this.store.loadStepRunsByRunId(run.id);
      for (const sr of existingStepRuns) {
        if (sr.status === "succeeded") completed.add(sr.stepId);
        else if (sr.status === "skipped") skipped.add(sr.stepId);
        else if (sr.status === "failed") failed.add(sr.stepId);
        else if (sr.status === "running") {
          running.add(sr.stepId);
          const stepDef = steps.find((s) => s.id === sr.stepId);
          if (stepDef) {
          }
        }
      }
      let hasFailure = false;
      while (completed.size + skipped.size + failed.size < steps.length) {
        if (active.cancelled) break;
        const ready = getReadySteps(steps, completed, skipped, failed, running);
        for (const step of ready) {
          if (running.has(step.id) || activeSteps.has(step.id)) continue;
          const currentRunning = activeSteps.size;
          const stepCanStart = maxConcurrent > 0 ? currentRunning < maxConcurrent : currentRunning === 0;
          if (!stepCanStart) break;
          const shouldSkip = (step.skipIfFailed ?? []).some((id) => failed.has(id)) || (step.skipIfSkipped ?? []).some((id) => skipped.has(id));
          if (shouldSkip) {
            const skippedRun = this.store.createStepRun(run.id, step.id, step.title, trigger, 1);
            this.store.updateStepRun(skippedRun.id, (r) => ({
              ...r,
              status: "skipped",
              finishedAt: this.now().toISOString(),
              result: "Skipped due to dependency failure."
            }));
            skipped.add(step.id);
            continue;
          }
          const stepRun = this.store.createStepRun(run.id, step.id, step.title, trigger, 1);
          running.add(step.id);
          this.store.updateStepRun(stepRun.id, (r) => ({
            ...r,
            status: "running",
            startedAt: this.now().toISOString()
          }));
          const stepTask = {
            ...task,
            id: `${task.id}-step-${step.id}`,
            prompt: step.prompt,
            tools: step.tools ?? task.tools,
            steps: void 0,
            maxConcurrentSteps: void 0,
            maxConcurrentRuns: void 0
          };
          const stepExec = this.executor.execute(stepTask, { ...run, id: stepRun.id });
          this.store.updateStepRun(stepRun.id, (r) => ({
            ...r,
            pid: stepExec.pid,
            stdoutPath: stepExec.stdoutPath,
            stderrPath: stepExec.stderrPath
          }));
          activeSteps.set(step.id, { execution: stepExec, cancelled: false });
        }
        if (activeSteps.size === 0) break;
        const results = await Promise.allSettled(
          Array.from(activeSteps.entries()).map(async ([stepId, entry]) => {
            try {
              const result = await entry.execution.completion;
              return { stepId, result, cancelled: entry.cancelled };
            } catch (error) {
              return { stepId, result: null, error, cancelled: entry.cancelled };
            }
          })
        );
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const { stepId, result, cancelled } = r.value;
          if (cancelled) continue;
          if (!result || result.exitCode !== 0) {
            this.store.updateStepRun(
              this.store.loadStepRunsByRunId(run.id).find((sr) => sr.stepId === stepId && sr.status === "running")?.id ?? "",
              (sr) => ({
                ...sr,
                status: "failed",
                finishedAt: this.now().toISOString(),
                error: result?.error || "Step failed.",
                exitCode: result?.exitCode
              })
            );
            failed.add(stepId);
            hasFailure = true;
          } else {
            this.store.updateStepRun(
              this.store.loadStepRunsByRunId(run.id).find((sr) => sr.stepId === stepId && sr.status === "running")?.id ?? "",
              (sr) => ({
                ...sr,
                status: "succeeded",
                finishedAt: this.now().toISOString(),
                result: result.result || readLog(sr.stdoutPath),
                sessionId: result.sessionId ?? sr.sessionId,
                sessionFile: result.sessionFile ?? sr.sessionFile
              })
            );
            completed.add(stepId);
          }
          running.delete(stepId);
          activeSteps.delete(stepId);
        }
        await new Promise((resolve2) => setTimeout(resolve2, 100));
      }
      const finalStatus = active.cancelled ? "cancelled" : hasFailure ? "failed" : "succeeded";
      return this.store.updateRun(run.id, (current) => ({
        ...current,
        status: finalStatus,
        finishedAt: this.now().toISOString()
      })) ?? run;
    } catch (error) {
      run = this.store.updateRun(run.id, (current) => ({
        ...current,
        status: "failed",
        finishedAt: this.now().toISOString(),
        error: error instanceof Error ? error.message : String(error)
      })) ?? run;
      this.maybeScheduleRetry(task, run);
      return run;
    } finally {
      this.activeRuns.delete(task.id);
    }
  }
  async tick() {
    const now = this.now();
    const due = this.store.loadTasks().filter((task) => task.status === "active" && task.nextRunAt && Date.parse(task.nextRunAt) <= now.getTime());
    for (const task of due) {
      if (this.activeRuns.has(task.id) || this.pendingRetries.has(task.id)) continue;
      this.advanceSchedule(task, now);
      void this.trigger(task.id, "scheduled");
    }
  }
  advanceSchedule(task, now) {
    this.store.updateTask(task.id, (current) => ({
      ...current,
      status: current.schedule.kind === "once" ? "paused" : current.status,
      nextRunAt: current.schedule.kind === "once" ? void 0 : nextRunForSchedule(current.schedule, now),
      updatedAt: now.toISOString()
    }));
  }
  maybeScheduleRetry(task, run) {
    if (!shouldRetryRun(task, run, "failed")) return;
    const policy = normalizeRetryPolicy(task.retry);
    if (!policy) return;
    const nextAttempt = (run.attempt ?? 1) + 1;
    const delay = computeBackoffMs(policy, run.attempt ?? 1);
    this.scheduleRetry(task.id, nextAttempt, run.id, delay);
  }
  requeueInterrupted(interrupted) {
    for (const run of interrupted) {
      const task = this.store.getTask(run.taskId);
      if (!task || task.status !== "active") continue;
      if (!shouldRetryRun(task, run, "interrupted")) continue;
      const policy = normalizeRetryPolicy(task.retry);
      if (!policy) continue;
      const nextAttempt = (run.attempt ?? 1) + 1;
      const delay = computeBackoffMs(policy, run.attempt ?? 1);
      this.scheduleRetry(task.id, nextAttempt, run.id, delay);
    }
  }
  scheduleRetry(taskId, attempt, parentRunId, delayMs) {
    this.clearPendingRetry(taskId);
    const timer = setTimeout(() => {
      this.pendingRetries.delete(taskId);
      void this.trigger(taskId, "retry", { attempt, parentRunId });
    }, delayMs);
    timer.unref?.();
    this.pendingRetries.set(taskId, { taskId, attempt, parentRunId, timer });
  }
  clearPendingRetry(taskId) {
    const pending = this.pendingRetries.get(taskId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRetries.delete(taskId);
  }
};
function cliEntryMtime() {
  try {
    const entry = process.argv[1];
    return entry ? statSync2(entry).mtimeMs : 0;
  } catch {
    return 0;
  }
}
var taskScheduler = new TaskScheduler();

// ../../packages/daemon/src/scheduler-ops.ts
var LOG_TAIL_BYTES = 256 * 1024;

// ../../packages/daemon/src/serve.ts
var startedAt = Date.now();

// electron/daemon.ts
function daemonCli() {
  const override = process.env.OPENPI_DAEMON_CLI;
  if (override) return override;
  const here2 = dirname4(fileURLToPath2(import.meta.url));
  const candidates = [
    // dev: apps/desktop/dist-electron -> repo root
    join5(here2, "../../../packages/daemon/src/cli.ts"),
    // packaged: resources/openpi/packages/daemon/src/cli.ts
    join5(process.resourcesPath ?? "", "openpi/packages/daemon/src/cli.ts")
  ];
  const found = candidates.find(existsSync3);
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
  const child = spawn2(process.execPath, ["--experimental-strip-types", daemonCli(), "serve"], {
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
    await new Promise((resolve2) => setTimeout(resolve2, 100));
  }
  throw new Error("daemon did not start within 4s");
}
async function restartIfStale() {
  const connection = await ensureDaemon();
  const health = await connection.request({ type: "health" });
  let onDiskMtime = 0;
  try {
    onDiskMtime = statSync3(health.cliPath).mtimeMs;
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
      await new Promise((resolve2) => setTimeout(resolve2, 100));
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
  // scheduled tasks
  "list_tasks",
  "create_task",
  "set_task_paused",
  "delete_task",
  "run_task",
  "cancel_run",
  "step_runs",
  "read_run_log",
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
    list_tasks: () => app2({ name: "list_tasks" }),
    create_task: (args) => app2({ name: "create_task", input: args.input }),
    set_task_paused: (args) => app2({ name: "set_task_paused", taskId: asString(args, "taskId"), paused: args.paused === true }),
    delete_task: (args) => app2({ name: "delete_task", taskId: asString(args, "taskId") }),
    run_task: (args) => app2({ name: "run_task", taskId: asString(args, "taskId") }),
    cancel_run: (args) => app2({ name: "cancel_run", runId: asString(args, "runId") }),
    step_runs: (args) => app2({ name: "step_runs", runId: asString(args, "runId") }),
    read_run_log: (args) => app2({
      name: "read_run_log",
      runId: asString(args, "runId"),
      stream: args.stream === "stderr" ? "stderr" : "stdout"
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
var here = dirname5(fileURLToPath3(import.meta.url));
var isDev = !app.isPackaged && process.env.OPENPI_DESKTOP_PROD !== "1";
var DEV_URL = "http://127.0.0.1:5179";
var mainWindow;
var DEFAULT_STATE = { width: 1400, height: 900 };
var MIN_WIDTH = 900;
var MIN_HEIGHT = 600;
var backgroundColor = () => nativeTheme.shouldUseDarkColors ? "#0b0d11" : "#eceff4";
function statePath() {
  const dir = join6(app.getPath("userData"), "window-state");
  if (!existsSync4(dir)) mkdirSync3(dir, { recursive: true });
  return join6(dir, "state.json");
}
function loadState() {
  try {
    const file = statePath();
    if (!existsSync4(file)) return void 0;
    const parsed = JSON.parse(readFileSync4(file, "utf8"));
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
    writeFileSync2(statePath(), JSON.stringify(bounds), "utf8");
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
    join6(here, "../build/icon.icns"),
    join6(here, "../build/icon.png"),
    join6(process.resourcesPath ?? "", "icon.icns")
  ];
  return candidates.find((candidate) => candidate && existsSync4(candidate));
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
      preload: join6(here, "preload.cjs"),
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
    void window.loadFile(join6(here, "../dist/index.html"));
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
