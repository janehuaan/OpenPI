import { execFileSync, spawn } from "node:child_process";
import { dialog } from "electron";
import { createConnection } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AGNES_IMAGE_MODEL, AGNES_VIDEO_MODEL, createAgnesMediaClient } from "./agnes-media.mjs";
import {
	ensureDaemon,
	getHealthSafe,
	listInstancesLive,
	probeDaemon,
	readTasksAndRuns,
	restartDaemon,
	rpc,
	sendIpcRequest,
	stopDaemon,
} from "./orch.mjs";
import {
	agentDir,
	defaultWorkspace,
	loadAgentSecretsEnv,
	nodeBinary,
	nodeSpawnEnv,
	openpiPackageFile,
	openpiPackagesRoot,
	repoRoot,
} from "./paths.mjs";

function resolveAgnesApiKey() {
	const secrets = loadAgentSecretsEnv();
	for (const value of [process.env.AGNES_API_KEY, process.env.AGNES_KEY, secrets.AGNES_API_KEY, secrets.AGNES_KEY]) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	try {
		const configPath = join(agentDir(), "models.json");
		if (!existsSync(configPath)) return undefined;
		const providers = JSON.parse(readFileSync(configPath, "utf8"))?.providers;
		if (!providers || typeof providers !== "object") return undefined;
		for (const [providerId, config] of Object.entries(providers)) {
			if (!providerId.toLowerCase().includes("agnes") || !config || typeof config !== "object") continue;
			if (typeof config.apiKey === "string" && config.apiKey.trim()) return config.apiKey.trim();
		}
	} catch {
		// Invalid optional provider configuration does not hide the missing-key error.
	}
	return undefined;
}

function agnesMediaClient() {
	const apiKey = resolveAgnesApiKey();
	if (!apiKey) {
		throw new Error("未配置 Agnes API Key。请在 ~/.pi/agent/secrets.env 中设置 AGNES_API_KEY。");
	}
	return createAgnesMediaClient({ apiKey });
}

function mediaFileExtension(mimeType, url) {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	if (mimeType === "image/gif") return "gif";
	if (mimeType === "video/mp4") return "mp4";
	try {
		const extension = new URL(url).pathname.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1];
		if (extension) return extension.toLowerCase();
	} catch {
		// Fall through to a safe default.
	}
	return mimeType?.startsWith("video/") ? "mp4" : "png";
}

async function saveGeneratedMedia(getMainWindow, { url, data, mimeType, filename } = {}) {
	let bytes;
	let resolvedMimeType = typeof mimeType === "string" ? mimeType : undefined;
	if (typeof data === "string" && data) {
		bytes = Buffer.from(data, "base64");
	} else if (typeof url === "string" && url) {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("不支持的媒体地址");
		const response = await fetch(parsed);
		if (!response.ok) throw new Error(`下载媒体失败 (${response.status})`);
		resolvedMimeType = resolvedMimeType ?? response.headers.get("content-type")?.split(";")[0];
		bytes = Buffer.from(await response.arrayBuffer());
	} else {
		throw new Error("缺少可保存的媒体内容");
	}
	const extension = mediaFileExtension(resolvedMimeType, url);
	const safeBase =
		typeof filename === "string" && filename.trim()
			? filename.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
			: `openpi-${Date.now()}`;
	const defaultPath = safeBase.toLowerCase().endsWith(`.${extension}`) ? safeBase : `${safeBase}.${extension}`;
	const options = { title: "保存生成内容", defaultPath };
	const window = getMainWindow();
	const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
	if (result.canceled || !result.filePath) return undefined;
	writeFileSync(result.filePath, bytes);
	return result.filePath;
}

function memoryOpsPath() {
	return openpiPackageFile("openpi-memory", "src", "desktop-ops.ts");
}

function bootstrapCliPath() {
	return openpiPackageFile("openpi-bootstrap", "src", "cli.ts");
}

function runMemoryOp(args) {
	const out = execFileSync(
		nodeBinary(),
		["--experimental-strip-types", memoryOpsPath(), ...args],
		{ encoding: "utf8", env: nodeSpawnEnv(), maxBuffer: 4 * 1024 * 1024 },
	);
	const line = out.trim().split("\n").filter(Boolean).pop() ?? "{}";
	const parsed = JSON.parse(line);
	if (!parsed.ok) throw new Error(parsed.error || "memory op failed");
	return parsed;
}

function listMemoryIndex(cwd, scope = "project") {
	return runMemoryOp(["list", cwd, scope || "project"]).lines ?? [];
}

function writeMemoryEntry(cwd, memoryType, key, value, body, scope = "project") {
	runMemoryOp([
		"write",
		cwd,
		memoryType || "project",
		key,
		JSON.stringify(value ?? ""),
		JSON.stringify(body ?? value ?? ""),
		scope || "project",
	]);
	return true;
}

function deleteMemoryEntry(cwd, memoryType, key, scope = "project") {
	runMemoryOp(["delete", cwd, memoryType || "project", key, scope || "project"]);
	return true;
}

function memoryMeta(cwd) {
	return runMemoryOp(["meta", cwd]);
}

function maintainMemory(cwd) {
	return runMemoryOp(["maintain", cwd]);
}


function securityConfigPath() {
	return join(agentDir(), "security.json");
}

function readSecurityMode() {
	const path = securityConfigPath();
	if (!existsSync(path)) return "confirm";
	try {
		const value = JSON.parse(readFileSync(path, "utf8"));
		return ["strict", "confirm", "permissive", "bypass"].includes(value?.mode) ? value.mode : "confirm";
	} catch {
		return "confirm";
	}
}

function listSecurityAudit(cwd) {
	if (!cwd) return [];
	const path = join(cwd, ".pi", "security", "audit.jsonl");
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.reverse()
		.slice(0, 100);
}

async function writeSecurityMode(mode) {
	if (!["strict", "confirm", "permissive", "bypass"].includes(mode)) throw new Error("Invalid mode");
	const agent = agentDir();
	mkdirSync(agent, { recursive: true });
	writeFileSync(join(agent, "security.json"), `${JSON.stringify({ mode, auditToDisk: true }, null, 2)}\n`, "utf8");
	try {
		await ensureDaemon();
		const instances = await listInstancesLive();
		await Promise.all(
			instances
				.filter((instance) => instance.status === "online" || instance.status === "starting")
				.map(async (instance) => {
					try {
						await rpc(instance.id, { type: "reload_resources" });
					} catch {
						// A session may settle or exit while the policy is changing.
					}
				}),
		);
	} catch {
		// Persistence succeeded. Sessions that could not reload pick up the mode on restart.
	}
	return true;
}

function listIntelligenceRuns(cwd) {
	const dir = join(cwd, ".pi", "intelligence", "runs");
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

function readIntelligenceRun(cwd, runId) {
	const path = join(cwd, ".pi", "intelligence", "runs", runId, "manifest.json");
	if (!existsSync(path)) throw new Error(`Run not found: ${runId}`);
	return readFileSync(path, "utf8");
}

function rpcData(response) {
	if (!response?.success) throw new Error(response?.error || "RPC command failed");
	return response.data;
}

export function registerBridge(ipcMain, getMainWindow) {
	const streams = new Map();

	ipcMain.handle("openpi:get_snapshot", async (_e, args = {}) => {
		const includeStopped = Boolean(args?.includeStopped);
		let daemonRunning = false;
		let health = {};
		let liveInstances = [];
		try {
			await ensureDaemon();
			const probe = await probeDaemon();
			daemonRunning = probe.alive;
			liveInstances = probe.list?.instances ?? (await listInstancesLive());
			const h = await getHealthSafe();
			if (h) health = h;
		} catch {
			daemonRunning = false;
		}
		const { tasks, runs, instances: fileInstances } = readTasksAndRuns();
		// Prefer daemon list; only fall back to file when daemon is down.
		// Drop error ghosts with no session (cannot resume → Unknown instance).
		const raw = (daemonRunning && liveInstances.length ? liveInstances : fileInstances).filter((instance) => {
			if (!instance?.id) return false;
			if (instance.status === "error" && !instance.sessionFile) return false;
			return true;
		});
		const all = raw.slice().sort((a, b) => {
			const rank = (status) => (status === "online" || status === "starting" ? 0 : status === "stopped" ? 2 : 1);
			return rank(a.status) - rank(b.status);
		});
		const active = all.filter((i) => i.status === "online" || i.status === "starting");
		const stopped = all.filter((i) => i.status === "stopped");
		// Default sidebar: only runnable instances. Stopped need resume and often break after restart.
		const selected = includeStopped ? all : active.length > 0 ? active : all.filter((i) => i.status !== "error");
		const instances = selected.slice(0, 80).map((instance) => ({
			id: instance.id,
			status: instance.status,
			mode: instance.mode === "code" ? "code" : "work",
			cwd: instance.cwd,
			label: instance.label,
			sessionId: instance.sessionId,
			sessionFile: instance.sessionFile,
		}));
		return {
			daemonRunning,
			health: {
				version: health.version,
				uptimeMs: health.uptimeMs,
				socketPath: health.socketPath,
				tasksActive: health.tasksActive ?? tasks.filter((task) => task.status === "active").length,
				tasksPaused: health.tasksPaused ?? tasks.filter((task) => task.status === "paused").length,
				runsRunning: health.runsRunning ?? runs.filter((run) => run.status === "running").length,
				runsQueued: health.runsQueued ?? runs.filter((run) => run.status === "queued").length,
			},
			instances,
			instanceStats: {
				total: all.length,
				active: active.length,
				stopped: stopped.length,
				shown: instances.length,
				includeStopped,
			},
			tasks,
			runs: runs.slice(-100),
		};
	});

	ipcMain.handle("openpi:start_daemon", async () => ensureDaemon());
	ipcMain.handle("openpi:stop_daemon", async () => stopDaemon());
	ipcMain.handle("openpi:restart_daemon", async () => restartDaemon());
	ipcMain.handle("openpi:prune_stopped_instances", async () => {
		await ensureDaemon();
		const live = await listInstancesLive();
		const stopped = live.filter((i) => i.status === "stopped");
		let deleted = 0;
		for (const instance of stopped) {
			try {
				const result = await sendIpcRequest({ type: "session_delete", instanceId: instance.id }, 15_000);
				if (result?.ok) deleted += 1;
			} catch {
				try {
					await sendIpcRequest({ type: "stop", instanceId: instance.id }, 8_000);
				} catch {
					// ignore
				}
			}
		}
		return { deleted, total: stopped.length };
	});
	ipcMain.handle("openpi:stop_instance", async (_e, instanceId) => {
		await ensureDaemon();
		await sendIpcRequest({ type: "stop", instanceId });
		return true;
	});

	ipcMain.handle("openpi:create_conversation", async (_e, { label, cwd, mode } = {}) => {
		const workspace = cwd || defaultWorkspace();
		const agentMode = mode === "code" ? "code" : "work";
		const spawnOnce = async () => {
			await ensureDaemon();
			const result = await sendIpcRequest(
				{
					type: "spawn",
					cwd: workspace,
					label: label || "Desktop",
					mode: agentMode,
				},
				60_000,
			);
			if (!result.ok || !result.instance?.id) {
				throw new Error(result.error || "spawn failed");
			}
			// Block until the child accepts RPC — avoids "Unknown instance" races right after create
			let lastError = "spawned but not ready";
			for (let attempt = 0; attempt < 25; attempt++) {
				try {
					const state = await rpc(result.instance.id, { type: "get_state" });
					if (state?.success) {
						return {
							...result.instance,
							status: result.instance.status || "online",
						};
					}
					lastError = state?.error || "get_state not ready";
				} catch (error) {
					lastError = error instanceof Error ? error.message : String(error);
				}
				await new Promise((r) => setTimeout(r, 120));
			}
			throw new Error(`新建对话超时：${lastError}`);
		};

		try {
			return await spawnOnce();
		} catch (first) {
			// One hard restart of the daemon, then retry once (stale socket / dead child)
			try {
				await restartDaemon();
				return await spawnOnce();
			} catch (second) {
				const a = first instanceof Error ? first.message : String(first);
				const b = second instanceof Error ? second.message : String(second);
				throw new Error(`无法创建对话：${b}${a !== b ? `（首次：${a}）` : ""}`);
			}
		}
	});

	ipcMain.handle("openpi:select_workspace", async (_e, { defaultPath } = {}) => {
		const options = {
			title: "选择代码项目",
			defaultPath: typeof defaultPath === "string" ? defaultPath : defaultWorkspace(),
			properties: ["openDirectory"],
		};
		const window = getMainWindow();
		const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
		return result.canceled ? undefined : result.filePaths[0];
	});

	ipcMain.handle("openpi:get_conversation", async (_e, { instanceId }) => {
		if (!instanceId || typeof instanceId !== "string") {
			throw new Error("缺少对话 instanceId");
		}
		await ensureDaemon();
		let state;
		let messages;
		try {
			state = rpcData(await rpc(instanceId, { type: "get_state" }));
			messages = rpcData(await rpc(instanceId, { type: "get_messages" }))?.messages ?? [];
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (/Unknown instance/i.test(msg)) {
				const err = new Error(
					`对话已失效（服务重启或实例已删除）。请点 + 新建对话。 [${instanceId.slice(0, 8)}]`,
				);
				err.code = "UNKNOWN_INSTANCE";
				throw err;
			}
			if (/RPC process exited|Failed to load extension/i.test(msg)) {
				// Surface the real reason (e.g. broken npm provider package) without the full stack dump
				const short = msg
					.replace(/^RPC process exited[^.]*\.\s*/i, "")
					.replace(/^Stderr:\s*/i, "")
					.slice(0, 400);
				throw new Error(
					`对话进程启动失败：${short || msg}。若是某个 npm 扩展/Provider 报错，可暂时从设置里移除该 package 后重试。`,
				);
			}
			throw error;
		}
		const status = await sendIpcRequest({ type: "status", instanceId });
		if (!status?.ok || !status.instance) {
			const err = new Error(
				`对话已失效（服务重启或实例已删除）。请点 + 新建对话。 [${instanceId.slice(0, 8)}]`,
			);
			err.code = "UNKNOWN_INSTANCE";
			throw err;
		}
		return {
			instance: status.instance,
			state: {
				model: state.model,
				thinkingLevel: state.thinkingLevel ?? "off",
				isStreaming: Boolean(state.isStreaming),
				isCompacting: Boolean(state.isCompacting),
				sessionId: state.sessionId ?? "",
				sessionName: state.sessionName,
				messageCount: messages.length,
				pendingMessageCount: state.pendingMessageCount ?? 0,
			},
			messages,
		};
	});

	ipcMain.handle("openpi:send_message", async (_e, { instanceId, message, images, sessionName }) => {
		await ensureDaemon();
		if (sessionName) {
			await rpc(instanceId, { type: "set_session_name", name: sessionName });
		}
		await rpc(instanceId, { type: "prompt", message, images });
		return true;
	});

	ipcMain.handle("openpi:abort_conversation", async (_e, { instanceId }) => {
		await rpc(instanceId, { type: "abort" });
		return true;
	});

	ipcMain.handle("openpi:rename_conversation", async (_e, { instanceId, name }) => {
		await ensureDaemon();
		await sendIpcRequest({ type: "session_rename", instanceId, name });
		const status = await sendIpcRequest({ type: "status", instanceId });
		return status.instance;
	});

	ipcMain.handle("openpi:delete_conversation", async (_e, { instanceId }) => {
		await ensureDaemon();
		await sendIpcRequest({ type: "session_delete", instanceId });
		return true;
	});

	ipcMain.handle("openpi:get_conversation_models", async (_e, { instanceId }) => {
		const data = rpcData(await rpc(instanceId, { type: "get_available_models" }));
		return data?.models ?? data ?? [];
	});

	ipcMain.handle("openpi:set_conversation_model", async (_e, { instanceId, provider, modelId }) => {
		await rpc(instanceId, { type: "set_model", provider, modelId });
		return rpcData(await rpc(instanceId, { type: "get_state" }));
	});

	ipcMain.handle("openpi:set_conversation_thinking_level", async (_e, { instanceId, level }) => {
		await rpc(instanceId, { type: "set_thinking_level", level });
		return rpcData(await rpc(instanceId, { type: "get_state" }));
	});

	ipcMain.handle("openpi:get_conversation_capabilities", async (_e, { instanceId }) => {
		return rpcData(await rpc(instanceId, { type: "get_capabilities" }));
	});

	ipcMain.handle("openpi:reload_conversation_capabilities", async (_e, { instanceId }) => {
		await rpc(instanceId, { type: "reload_resources" });
		return rpcData(await rpc(instanceId, { type: "get_capabilities" }));
	});

	ipcMain.handle("openpi:install_conversation_package", async (_e, { instanceId, source, local }) => {
		await rpc(instanceId, { type: "install_package", source, local });
		return rpcData(await rpc(instanceId, { type: "get_capabilities" }));
	});

	ipcMain.handle("openpi:remove_conversation_package", async (_e, { instanceId, source, local }) => {
		await rpc(instanceId, { type: "remove_package", source, local });
		return rpcData(await rpc(instanceId, { type: "get_capabilities" }));
	});

	ipcMain.handle("openpi:get_conversation_commands", async (_e, { instanceId }) => {
		const data = rpcData(await rpc(instanceId, { type: "get_commands" }));
		const commands = data?.commands ?? [];
		return commands.map((cmd) => `/${cmd.name}${cmd.description ? ` — ${cmd.description}` : ""}`);
	});

	ipcMain.handle("openpi:watch_conversation_stream", async (event, { instanceId }) => {
		await ensureDaemon();
		const existing = streams.get(instanceId);
		if (existing) {
			existing.kill?.();
			streams.delete(instanceId);
		}
		const { orchestratorDir } = await import("./paths.mjs");
		const path = join(orchestratorDir(), "orchestrator.sock");
		const socket = createConnection(path);
		let buffer = "";
		socket.on("connect", () => {
			socket.write(encode({ type: "rpc_stream", instanceId }));
			event.sender.send("openpi:conversation-event", {
				instanceId,
				event: { type: "rpc_ready" },
			});
		});
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			while (true) {
				const idx = buffer.indexOf("\n");
				if (idx === -1) break;
				const line = buffer.slice(0, idx).trim();
				buffer = buffer.slice(idx + 1);
				if (!line) continue;
				try {
					const payload = JSON.parse(line);
					event.sender.send("openpi:conversation-event", { instanceId, event: payload });
				} catch {
					// ignore
				}
			}
		});
		socket.on("error", (error) => {
			event.sender.send("openpi:conversation-event", {
				instanceId,
				event: { type: "stream_error", error: error.message },
			});
		});
		streams.set(instanceId, {
			kill: () => {
				socket.end();
			},
			socket,
		});
		return true;
	});

	ipcMain.handle("openpi:stop_conversation_stream", async (_e, { instanceId }) => {
		streams.get(instanceId)?.kill?.();
		streams.delete(instanceId);
		return true;
	});

	ipcMain.handle("openpi:respond_conversation_ui", async (_e, { instanceId, response }) => {
		const stream = streams.get(instanceId);
		if (!stream?.socket) throw new Error("No active stream for UI response");
		stream.socket.write(
			encode({
				type: "extension_ui_response",
				id: response.id,
				value: response.value,
				confirmed: response.confirmed,
				cancelled: response.cancelled,
			}),
		);
		return true;
	});

	ipcMain.handle("openpi:create_task", async (_e, { input }) => {
		await ensureDaemon();
		const schedule = input.schedule;
		const result = await sendIpcRequest({
			type: "task_create",
			title: input.title,
			prompt: input.prompt,
			cwd: input.cwd || defaultWorkspace(),
			schedule,
			securityMode: input.securityMode || "strict",
		});
		if (!result.ok || !result.task) throw new Error(result.error || "create task failed");
		return result.task;
	});

	ipcMain.handle("openpi:set_task_paused", async (_e, { taskId, paused }) => {
		await ensureDaemon();
		const result = await sendIpcRequest({ type: "task_pause", taskId, paused });
		if (!result.ok || !result.task) throw new Error(result.error || "pause failed");
		return result.task;
	});

	ipcMain.handle("openpi:delete_task", async (_e, { taskId }) => {
		await ensureDaemon();
		const result = await sendIpcRequest({ type: "task_delete", taskId });
		return Boolean(result.ok && result.deleted);
	});

	ipcMain.handle("openpi:run_task", async (_e, { taskId }) => {
		await ensureDaemon();
		const result = await sendIpcRequest({ type: "task_run", taskId });
		if (!result.ok || !result.run) throw new Error(result.error || "run failed");
		return result.run;
	});

	ipcMain.handle("openpi:cancel_run", async (_e, { runId }) => {
		await ensureDaemon();
		const result = await sendIpcRequest({ type: "task_cancel", runId });
		if (!result.ok || !result.run) throw new Error(result.error || "cancel failed");
		return result.run;
	});

	ipcMain.handle("openpi:read_run_log", async (_e, { runId, stream }) => {
		const { orchestratorDir } = await import("./paths.mjs");
		const logPath = join(
			orchestratorDir(),
			"task-logs",
			`${runId}.${stream === "stderr" ? "stderr" : "stdout"}.log`,
		);
		if (!existsSync(logPath)) return "";
		return readFileSync(logPath, "utf8");
	});

	ipcMain.handle("openpi:list_memory_index", async (_e, { cwd, scope }) =>
		listMemoryIndex(cwd || defaultWorkspace(), scope || "project"),
	);
	ipcMain.handle("openpi:write_memory_entry", async (_e, args) =>
		writeMemoryEntry(
			args.cwd || defaultWorkspace(),
			args.memoryType,
			args.key,
			args.value,
			args.body,
			args.scope || "project",
		),
	);
	ipcMain.handle("openpi:delete_memory_entry", async (_e, args) =>
		deleteMemoryEntry(args.cwd || defaultWorkspace(), args.memoryType, args.key, args.scope || "project"),
	);
	ipcMain.handle("openpi:memory_meta", async (_e, { cwd }) => memoryMeta(cwd || defaultWorkspace()));
	ipcMain.handle("openpi:maintain_memory", async (_e, { cwd }) => maintainMemory(cwd || defaultWorkspace()));
	ipcMain.handle("openpi:list_security_audit", async (_e, { cwd }) => listSecurityAudit(cwd || defaultWorkspace()));
	ipcMain.handle("openpi:get_security_mode", async () => readSecurityMode());
	ipcMain.handle("openpi:write_security_mode", async (_e, { mode }) =>
		writeSecurityMode(mode),
	);
	ipcMain.handle("openpi:list_intelligence_runs", async (_e, { cwd }) =>
		listIntelligenceRuns(cwd || defaultWorkspace()),
	);
	ipcMain.handle("openpi:read_intelligence_run", async (_e, { cwd, runId }) =>
		readIntelligenceRun(cwd || defaultWorkspace(), runId),
	);

	ipcMain.handle("openpi:setup_status", async () => {
		const settings = join(agentDir(), "settings.json");
		const product = join(agentDir(), "openpi.json");
		let enabled = existsSync(product);
		// Also treat as enabled if openpi extensions are already wired in settings
		if (!enabled && existsSync(settings)) {
			try {
				const parsed = JSON.parse(readFileSync(settings, "utf8"));
				const extensions = Array.isArray(parsed.extensions) ? parsed.extensions : [];
				enabled = extensions.some((entry) => typeof entry === "string" && entry.includes("openpi-memory"));
			} catch {
				// ignore
			}
		}
		return {
			enabled,
			agentDir: agentDir(),
			workspace: defaultWorkspace(),
			repoRoot: openpiPackagesRoot() || repoRoot(),
		};
	});

	ipcMain.handle("openpi:run_setup", async () => {
		// Prefer packaged openpi-packages root so extensions resolve without a monorepo checkout.
		const packagesRoot = openpiPackagesRoot() || repoRoot();
		await new Promise((resolve, reject) => {
			const child = spawn(
				nodeBinary(),
				["--experimental-strip-types", bootstrapCliPath(), "--repo", packagesRoot, "--no-autostart"],
				{ stdio: "inherit", env: nodeSpawnEnv() },
			);
			child.on("error", reject);
			child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`setup exit ${code}`))));
		});
		await ensureDaemon();
		return { ok: true };
	});

	ipcMain.handle("openpi:doctor", async () => {
		return await new Promise((resolve, reject) => {
			const child = spawn(
				nodeBinary(),
				["--experimental-strip-types", bootstrapCliPath(), "doctor"],
				{ stdio: ["ignore", "pipe", "pipe"], env: nodeSpawnEnv() },
			);
			const out = [];
			const err = [];
			child.stdout.on("data", (c) => out.push(c));
			child.stderr.on("data", (c) => err.push(c));
			child.on("error", reject);
			child.on("close", (code) => {
				resolve({
					ok: code === 0,
					output: Buffer.concat(out).toString("utf8") + Buffer.concat(err).toString("utf8"),
				});
			});
		});
	});

	ipcMain.handle("openpi:default_workspace", async () => defaultWorkspace());

	// --- Model provider management (reads/writes ~/.pi/agent/models.json) ---
	function readModelsConfig() {
		const configPath = join(agentDir(), "models.json");
		if (!existsSync(configPath)) return { providers: {} };
		try {
			const raw = readFileSync(configPath, "utf8");
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== "object" || !parsed.providers) {
				return { providers: {} };
			}
			return parsed;
		} catch {
			return { providers: {} };
		}
	}

	function writeModelsConfig(config) {
		const configPath = join(agentDir(), "models.json");
		const dir = agentDir();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	}

	ipcMain.handle("openpi:get_model_providers", async () => {
		return readModelsConfig().providers;
	});

	ipcMain.handle("openpi:save_model_provider", async (_e, { providerId, config }) => {
		if (typeof providerId !== "string" || !providerId.trim()) {
			throw new Error("providerId is required");
		}
		const current = readModelsConfig();
		current.providers[providerId] = config;
		writeModelsConfig(current);
		return true;
	});

	ipcMain.handle("openpi:delete_model_provider", async (_e, { providerId }) => {
		if (typeof providerId !== "string" || !providerId.trim()) {
			throw new Error("providerId is required");
		}
		const current = readModelsConfig();
		delete current.providers[providerId];
		writeModelsConfig(current);
		return true;
	});

	ipcMain.handle("openpi:get_media_capabilities", async () => ({
		configured: Boolean(resolveAgnesApiKey()),
		imageModel: AGNES_IMAGE_MODEL,
		videoModel: AGNES_VIDEO_MODEL,
	}));
	ipcMain.handle("openpi:generate_image", async (_e, input) => agnesMediaClient().generateImage(input));
	ipcMain.handle("openpi:create_video", async (_e, input) => agnesMediaClient().createVideo(input));
	ipcMain.handle("openpi:get_video", async (_e, { videoId }) => agnesMediaClient().getVideo(videoId));
	ipcMain.handle("openpi:save_media", async (_e, input) => saveGeneratedMedia(getMainWindow, input));
}

function encode(message) {
	return `${JSON.stringify(message)}\n`;
}
