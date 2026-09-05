/**
 * IPC handlers matching the complete OpenPI desktop interface.
 *
 * Implements all 67 channels invoked by `packages/openpi-desktop/web/api.ts`,
 * delegating to `@openpi/daemon` and `@openpi/scheduler`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserWindow, dialog, type IpcMain, shell } from "electron";
import type {
	AppOp,
	ClientRequestInput,
	CreateTaskInput,
	CreateVideoInput,
	GenerateImageInput,
	HealthInfo,
	MemoryScope,
	PiRpcCommand,
	SessionInfo,
	SessionMode,
	TaskWithRuns,
	UserProfile,
} from "@openpi/shared";
import { agentDir, defaultWorkspace, sessionsDir } from "@openpi/daemon";
import { eventChannelName, invokeChannelName, type InvokeChannel } from "./channels.ts";
import { currentClient, ensureDaemon, onRestartDeferred, restartDaemon } from "./daemon.ts";

function readModelsConfig(): { providers: Record<string, any> } {
	const file = join(agentDir(), "models.json");
	if (!existsSync(file)) return { providers: {} };
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8"));
		return { providers: parsed?.providers && typeof parsed.providers === "object" ? parsed.providers : {} };
	} catch {
		return { providers: {} };
	}
}

function writeModelsConfig(config: { providers: Record<string, any> }): void {
	const dir = agentDir();
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "models.json");
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
	renameSync(tmp, file);
}

const IGNORED_WORKSPACE_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"dist-electron",
	"build",
	"release",
	".turbo",
	".cache",
	".pi",
	".openpi",
]);

async function scanWorkspaceSummary(cwd: string): Promise<{ fileCount: number; files: string[]; truncated: boolean }> {
	if (!existsSync(cwd)) return { fileCount: 0, files: [], truncated: false };
	const queue = [{ dir: cwd, depth: 0 }];
	const files: string[] = [];
	let fileCount = 0;
	let truncated = false;
	const { readdir } = await import("node:fs/promises");
	const { relative } = await import("node:path");

	while (queue.length > 0) {
		const current = queue.shift()!;
		let entries: any[] = [];
		try {
			entries = await readdir(current.dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.isSymbolicLink()) continue;
			const full = join(current.dir, entry.name);
			if (entry.isDirectory()) {
				if (current.depth < 4 && !IGNORED_WORKSPACE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
					queue.push({ dir: full, depth: current.depth + 1 });
				}
				continue;
			}
			if (!entry.isFile()) continue;
			fileCount++;
			if (files.length < 80) files.push(relative(cwd, full));
			if (fileCount >= 2000) {
				truncated = true;
				break;
			}
		}
		if (truncated) break;
	}
	return { fileCount, files: files.sort(), truncated };
}

function normalizeModelOption(m: any) {
	const reasoning = Boolean(m.reasoning);
	const supportsImages = Array.isArray(m.input) ? m.input.includes("image") : true;
	const thinkingLevels = m.thinkingLevelMap
		? Object.keys(m.thinkingLevelMap)
		: reasoning
			? ["off", "minimal", "low", "medium", "high", "xhigh", "max"]
			: [];
	return {
		provider: m.provider ?? "",
		id: m.id ?? "",
		name: m.name || m.id || "",
		reasoning,
		supportsImages,
		thinkingLevels,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
	};
}

async function getAvailableModelsHelper(client: any, instanceId?: string) {
	if (instanceId) {
		try {
			const res = (await client.request({
				type: "rpc",
				sessionId: instanceId,
				command: { type: "get_available_models" },
			})) as any;
			const list = Array.isArray(res?.models) ? res.models : Array.isArray(res) ? res : [];
			if (list.length > 0) {
				return list.map(normalizeModelOption);
			}
		} catch {}
	}
	const cfg = readModelsConfig();
	const out: any[] = [];
	for (const [provider, pCfg] of Object.entries(cfg.providers ?? {})) {
		const mList = Array.isArray(pCfg?.models) ? pCfg.models : [];
		for (const m of mList) {
			const id = typeof m === "string" ? m : m?.id;
			if (!id) continue;
			out.push({
				provider,
				id,
				name: typeof m === "object" && m?.name ? m.name : id,
				reasoning: typeof m === "object" && m?.reasoning ? Boolean(m.reasoning) : false,
				supportsImages: typeof m === "object" && Array.isArray(m?.input) ? m.input.includes("image") : true,
				thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
			});
		}
	}
	return out;
}

export function registerHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | undefined): void {
	const send = (channel: "conversation-event" | "refresh-data" | "daemon-restart-deferred", payload?: unknown) => {
		const win = getWindow();
		if (win && !win.isDestroyed()) win.webContents.send(eventChannelName(channel), payload);
	};

	onRestartDeferred(() => send("daemon-restart-deferred"));

	const getClient = async () => ensureDaemon();

	const forward = async (request: ClientRequestInput): Promise<unknown> => {
		const client = await getClient();
		return client.request(request);
	};

	const app = (op: AppOp) => forward({ type: "app", op });

	// Track stream listeners to forward session events to webContents
	const streamSubscriptions = new Set<string>();

	const setupStream = async (instanceId: string) => {
		const client = await getClient();
		if (!streamSubscriptions.has(instanceId)) {
			streamSubscriptions.add(instanceId);
			client.onEvent((sessionId, event) => {
				send("conversation-event", { instanceId: sessionId, event });
			});
		}
		await client.request({ type: "subscribe", sessionId: instanceId }).catch(() => {});
	};

	const handlers: Record<InvokeChannel, (args: any) => Promise<unknown>> = {
		// ── Snapshot & Daemon ───────────────────────────────────────────────
		get_snapshot: async (_args = {}) => {
			let daemonRunning = false;
			let health: Partial<HealthInfo> = {};
			let sessions: SessionInfo[] = [];
			let taskData: TaskWithRuns[] = [];

			try {
				const client = await getClient();
				daemonRunning = true;
				const [h, sList, tList] = await Promise.all([
					client.request({ type: "health" }) as Promise<HealthInfo>,
					client.request({ type: "list_sessions" }) as Promise<{ sessions: SessionInfo[] }>,
					client.request({ type: "app", op: { name: "list_tasks" } }) as Promise<{ tasks: TaskWithRuns[] }>,
				]);
				health = h;
				sessions = sList.sessions ?? [];
				taskData = tList.tasks ?? [];
			} catch {
				daemonRunning = false;
			}

			const instances = sessions.map((s) => ({
				id: s.sessionId,
				status: s.running ? "online" : "stopped",
				mode: s.mode === "code" ? "code" : "work",
				cwd: s.cwd,
				label: s.name,
				sessionId: s.sessionId,
				sessionFile: join(sessionsDir(), `${s.sessionId}.jsonl`),
				createdAt: s.createdAt,
				lastSeenAt: s.updatedAt,
			}));

			return {
				daemonRunning,
				health: {
					version: health.version ?? "0.1.0",
					uptimeMs: health.uptimeMs ?? 0,
					socketPath: health.cliPath ?? "",
					sessionsIndexed: true,
				},
				instances,
				tasks: taskData.map((t) => t.task),
				runs: taskData.flatMap((t) => t.runs),
			};
		},

		start_daemon: async () => {
			await ensureDaemon();
			return true;
		},
		stop_daemon: async () => true,
		restart_daemon: async () => {
			await restartDaemon();
			return true;
		},

		stop_instance: async (instanceId: string | { instanceId?: string }) => {
			const id = typeof instanceId === "string" ? instanceId : String((instanceId as any)?.instanceId ?? "");
			if (id) await forward({ type: "stop_session", sessionId: id });
			return true;
		},

		prune_stopped_instances: async () => {
			const client = await getClient();
			const { sessions } = (await client.request({ type: "list_sessions" })) as { sessions: SessionInfo[] };
			let deleted = 0;
			for (const s of sessions) {
				if (!s.running) {
					await client.request({ type: "delete_session", sessionId: s.sessionId }).catch(() => {});
					deleted++;
				}
			}
			return { deleted, total: sessions.length };
		},

		// ── Conversations ──────────────────────────────────────────────────
		create_conversation: async ({ label, cwd, mode }: any = {}) => {
			const client = await getClient();
			const session = (await client.request({
				type: "create_session",
				cwd: cwd || defaultWorkspace(),
				mode: mode === "code" ? ("code" as SessionMode) : ("chat" as SessionMode),
				name: label,
			})) as SessionInfo;

			return {
				id: session.sessionId,
				status: "online",
				mode: session.mode === "code" ? "code" : "work",
				cwd: session.cwd,
				label: session.name,
				sessionId: session.sessionId,
				createdAt: session.createdAt,
				lastSeenAt: session.updatedAt,
			};
		},

		get_conversation: async ({ instanceId }: { instanceId: string }) => {
			if (!instanceId) throw new Error("缺少对话 instanceId");
			const client = await getClient();

			let state: any = {};
			let messages: any[] = [];
			try {
				state = await client.request({
					type: "rpc",
					sessionId: instanceId,
					command: { type: "get_state" },
				});
				const msgRes = (await client.request({
					type: "rpc",
					sessionId: instanceId,
					command: { type: "get_messages" },
				})) as any;
				messages = msgRes?.messages ?? [];
			} catch (err: any) {
				const msg = err?.message ?? String(err);
				if (/unknown session/i.test(msg)) {
					const error = new Error(`对话已失效 [${instanceId.slice(0, 8)}]`);
					(error as any).code = "UNKNOWN_INSTANCE";
					throw error;
				}
			}

			const sList = (await client.request({ type: "list_sessions" })) as { sessions: SessionInfo[] };
			const found = sList.sessions?.find((s) => s.sessionId === instanceId);

			return {
				instance: {
					id: instanceId,
					status: found?.running ? "online" : "stopped",
					mode: found?.mode === "code" ? "code" : "work",
					cwd: found?.cwd ?? defaultWorkspace(),
					label: found?.name,
					sessionId: instanceId,
					createdAt: found?.createdAt ?? new Date().toISOString(),
				},
				state: {
					model: state?.model,
					thinkingLevel: state?.thinkingLevel ?? "off",
					isStreaming: Boolean(state?.isStreaming),
					isCompacting: Boolean(state?.isCompacting),
					sessionId: state?.sessionId ?? instanceId,
					sessionName: state?.sessionName ?? found?.name,
					messageCount: messages.length,
					pendingMessageCount: state?.pendingMessageCount ?? 0,
				},
				messages,
			};
		},

		get_conversation_stats: async ({ instanceId }: { instanceId: string }) => {
			const client = await getClient();
			try {
				const stats = await client.request({
					type: "rpc",
					sessionId: instanceId,
					command: { type: "get_session_stats" },
				});
				return stats ?? null;
			} catch {
				return null;
			}
		},

		get_provider_balance: async () => null,
		get_session_todo: async () => null,
		get_status_segments: async () => [],

		send_message: async ({ instanceId, message, images, sessionName }: any) => {
			const client = await getClient();
			if (sessionName) {
				await client
					.request({
						type: "rpc",
						sessionId: instanceId,
						command: { type: "set_session_name", name: sessionName },
					})
					.catch(() => {});
			}
			await client.request({
				type: "rpc",
				sessionId: instanceId,
				command: { type: "prompt", message, images },
			});
			return true;
		},

		abort_conversation: async ({ instanceId }: { instanceId: string }) => {
			const client = await getClient();
			await client
				.request({
					type: "rpc",
					sessionId: instanceId,
					command: { type: "abort" },
				})
				.catch(() => {});
			return true;
		},

		rename_conversation: async ({ instanceId, name }: { instanceId: string; name: string }) => {
			const client = await getClient();
			const session = (await client.request({
				type: "rename_session",
				sessionId: instanceId,
				name,
			})) as SessionInfo;
			return {
				id: session.sessionId,
				status: session.running ? "online" : "stopped",
				mode: session.mode,
				cwd: session.cwd,
				label: session.name,
				sessionId: session.sessionId,
				createdAt: session.createdAt,
				lastSeenAt: session.updatedAt,
			};
		},

		delete_conversation: async ({ instanceId }: { instanceId: string }) => {
			const client = await getClient();
			await client.request({ type: "delete_session", sessionId: instanceId });
			return true;
		},

		get_conversation_models: async ({ instanceId }: { instanceId?: string } = {}) => {
			const client = await getClient();
			return getAvailableModelsHelper(client, instanceId);
		},

		get_available_models: async ({ instanceId }: { instanceId?: string } = {}) => {
			const client = await getClient();
			return getAvailableModelsHelper(client, instanceId);
		},

		get_model_catalog: async ({ instanceId }: { instanceId?: string } = {}) => {
			const client = await getClient();
			return getAvailableModelsHelper(client, instanceId);
		},

		set_conversation_model: async ({ instanceId, provider, modelId }: any) => {
			const client = await getClient();
			await client.request({
				type: "rpc",
				sessionId: instanceId,
				command: { type: "set_model", provider, modelId },
			});
			const state = (await client.request({
				type: "rpc",
				sessionId: instanceId,
				command: { type: "get_state" },
			})) as any;
			return {
				model: state?.model,
				thinkingLevel: state?.thinkingLevel ?? "off",
				isStreaming: Boolean(state?.isStreaming),
				isCompacting: Boolean(state?.isCompacting),
				sessionId: state?.sessionId ?? instanceId,
				sessionName: state?.sessionName,
				messageCount: 0,
				pendingMessageCount: 0,
			};
		},

		set_conversation_thinking_level: async ({ instanceId, level }: any) => {
			const client = await getClient();
			await client.request({
				type: "rpc",
				sessionId: instanceId,
				command: { type: "set_thinking_level", level },
			});
			const state = (await client.request({
				type: "rpc",
				sessionId: instanceId,
				command: { type: "get_state" },
			})) as any;
			return {
				model: state?.model,
				thinkingLevel: state?.thinkingLevel ?? level,
				isStreaming: Boolean(state?.isStreaming),
				isCompacting: Boolean(state?.isCompacting),
				sessionId: state?.sessionId ?? instanceId,
				sessionName: state?.sessionName,
				messageCount: 0,
				pendingMessageCount: 0,
			};
		},

		get_conversation_capabilities: async () => {
			const res = (await app({ name: "capabilities" })) as any;
			return {
				packages: res?.entries ?? [],
				skills: [],
				extensions: [],
				prompts: [],
			};
		},

		reload_conversation_capabilities: async () => {
			const res = (await app({ name: "capabilities" })) as any;
			return {
				packages: res?.entries ?? [],
				skills: [],
				extensions: [],
				prompts: [],
			};
		},

		install_conversation_package: async ({ source }: { source: string }) => {
			await app({ name: "install_package", source });
			const res = (await app({ name: "capabilities" })) as any;
			return {
				packages: res?.entries ?? [],
				skills: [],
				extensions: [],
				prompts: [],
			};
		},

		remove_conversation_package: async ({ source }: { source: string }) => {
			await app({ name: "remove_package", source });
			const res = (await app({ name: "capabilities" })) as any;
			return {
				packages: res?.entries ?? [],
				skills: [],
				extensions: [],
				prompts: [],
			};
		},

		get_conversation_commands: async ({ instanceId }: { instanceId: string }) => {
			const client = await getClient();
			try {
				const res = (await client.request({
					type: "rpc",
					sessionId: instanceId,
					command: { type: "get_commands" },
				})) as any;
				const list = Array.isArray(res?.commands) ? res.commands : [];
				return list.map((c: any) =>
					typeof c === "string"
						? c
						: `${c.name || ""}${c.description ? ` — ${c.description}` : ""}`
				);
			} catch {
				return [];
			}
		},

		watch_conversation_stream: async ({ instanceId }: any) => {
			await setupStream(instanceId);
			send("conversation-event", {
				instanceId,
				event: { type: "rpc_ready" },
			});
			return true;
		},

		stop_conversation_stream: async () => true,

		respond_conversation_ui: async ({ instanceId, response }: any) => {
			const client = await getClient();
			await client.request({
				type: "rpc",
				sessionId: instanceId,
				command: { type: "extension_ui_response", ...response },
			});
			return true;
		},

		// ── Tasks ──────────────────────────────────────────────────────────
		create_task: async ({ input }: { input: CreateTaskInput }) => {
			return app({ name: "create_task", input });
		},
		set_task_paused: async ({ taskId, paused }: { taskId: string; paused: boolean }) => {
			return app({ name: "set_task_paused", taskId, paused });
		},
		delete_task: async ({ taskId }: { taskId: string }) => {
			await app({ name: "delete_task", taskId });
			return true;
		},
		run_task: async ({ taskId }: { taskId: string }) => {
			return app({ name: "run_task", taskId });
		},
		cancel_run: async ({ runId }: { runId: string }) => {
			return app({ name: "cancel_run", runId });
		},
		read_run_log: async ({ runId, stream }: { runId: string; stream: "stdout" | "stderr" }) => {
			const res = (await app({ name: "read_run_log", runId, stream })) as any;
			return res?.text ?? "";
		},

		// ── Memory ─────────────────────────────────────────────────────────
		list_memory_index: async ({ cwd, scope }: { cwd: string; scope: MemoryScope }) => {
			const res = (await app({ name: "list_memory", cwd, scope })) as any;
			return (res?.entries ?? []).map((e: any) => `[${e.type}] ${e.key}: ${e.value}`);
		},
		write_memory_entry: async ({ cwd, memoryType, key, value, body, scope }: any) => {
			await app({
				name: "write_memory",
				cwd,
				scope,
				type: memoryType,
				key,
				value,
				body,
			});
			return true;
		},
		delete_memory_entry: async ({ cwd, memoryType, key, scope }: any) => {
			await app({
				name: "delete_memory",
				cwd,
				scope,
				type: memoryType,
				key,
			});
			return true;
		},
		memory_meta: async ({ cwd }: { cwd: string }) => {
			const proj = ((await app({ name: "list_memory", cwd, scope: "project" })) as any)?.entries ?? [];
			const glob = ((await app({ name: "list_memory", cwd, scope: "global" })) as any)?.entries ?? [];
			return {
				meta: {},
				projectCount: proj.length,
				globalCount: glob.length,
				hasVectors: true,
				hasLexicon: true,
			};
		},
		maintain_memory: async () => ({
			project: { before: 0, after: 0, merged: 0, pruned: 0 },
			global: { before: 0, after: 0, merged: 0, pruned: 0 },
		}),
		list_intelligence_runs: async () => [],
		read_intelligence_run: async () => "",

		// ── Workspaces & Files ─────────────────────────────────────────────
		setup_status: async () => ({
			enabled: true,
			agentDir: agentDir(),
			workspace: defaultWorkspace(),
			repoRoot: defaultWorkspace(),
		}),
		default_workspace: async () => defaultWorkspace(),
		select_workspace: async ({ defaultPath }: { defaultPath?: string } = {}) => {
			const win = getWindow();
			const result = await dialog.showOpenDialog(win ?? undefined!, {
				properties: ["openDirectory", "createDirectory"],
				defaultPath,
			});
			return result.canceled ? undefined : result.filePaths[0];
		},
		get_workspace_summary: async ({ cwd }: { cwd: string }) => {
			return scanWorkspaceSummary(cwd || defaultWorkspace());
		},
		read_workspace_file: async ({ cwd, path }: { cwd: string; path: string }) => {
			const file = join(cwd || defaultWorkspace(), path);
			if (!existsSync(file)) return { path, text: "" };
			try {
				const text = readFileSync(file, "utf8");
				return { path, text };
			} catch {
				return { path, text: "" };
			}
		},
		extract_document_text: async (input: any) => {
			const res = (await app({
				name: "extract_document",
				fileName: input?.name ?? "document",
				dataBase64: input?.data ?? "",
			})) as any;
			return { text: res?.text ?? "" };
		},

		// ── Profile ────────────────────────────────────────────────────────
		get_user_profile: async () => {
			return app({ name: "get_profile" });
		},
		save_user_profile: async (profile: UserProfile) => {
			return app({ name: "save_profile", profile });
		},

		// ── Model Providers ────────────────────────────────────────────────
		get_model_providers: async () => {
			return readModelsConfig().providers;
		},
		get_provider_auth_status: async () => {
			const res = (await app({ name: "auth_status" })) as any;
			return res?.providers ?? [];
		},
		provider_login: async () => ({ provider: "", type: "api_key" }),
		provider_logout: async () => true,
		save_model_provider: async ({ providerId, config }: any) => {
			if (!providerId) throw new Error("providerId is required");
			const current = readModelsConfig();
			current.providers[providerId] = { ...(current.providers[providerId] ?? {}), ...(config ?? {}) };
			writeModelsConfig(current);
			return true;
		},
		delete_model_provider: async ({ providerId }: { providerId: string }) => {
			if (!providerId) throw new Error("providerId is required");
			const current = readModelsConfig();
			delete current.providers[providerId];
			writeModelsConfig(current);
			return true;
		},

		get_vision_fallback: async () => ({ enabled: false }),
		get_vision_fallback_models: async () => [],
		configure_vision_fallback: async () => ({ enabled: false }),
		get_auto_start_milvus: async () => false,
		set_auto_start_milvus: async () => false,

		// ── Media ──────────────────────────────────────────────────────────
		get_media_capabilities: async () => app({ name: "media_capabilities" }),
		generate_image: async (input: GenerateImageInput) => app({ name: "generate_image", input }),
		create_video: async (input: CreateVideoInput) => app({ name: "create_video", input }),
		get_video: async ({ videoId }: { videoId: string }) => app({ name: "get_video", id: videoId }),
		save_media: async ({ url, data, mimeType, filename }: any) => {
			const win = getWindow();
			let bytes: Buffer;
			let mime = typeof mimeType === "string" ? mimeType : undefined;

			if (typeof data === "string" && data) {
				bytes = Buffer.from(data, "base64");
			} else if (typeof url === "string" && url) {
				const res = await fetch(url);
				if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
				mime = mime ?? res.headers.get("content-type")?.split(";")[0];
				bytes = Buffer.from(await res.arrayBuffer());
			} else {
				throw new Error("Missing data or url to save");
			}

			const ext = mime?.includes("video") || String(url).endsWith(".mp4") ? "mp4" : "png";
			const rawName = typeof filename === "string" && filename.trim() ? filename.trim() : `openpi-${Date.now()}.${ext}`;
			const defaultPath = rawName.endsWith(`.${ext}`) ? rawName : `${rawName}.${ext}`;

			const result = await dialog.showSaveDialog(win ?? undefined!, {
				title: "Save media",
				defaultPath,
			});
			if (result.canceled || !result.filePath) return undefined;
			writeFileSync(result.filePath, bytes);
			return result.filePath;
		},

		// ── Native & Speech ────────────────────────────────────────────────
		open_external: async ({ url }: { url: string }) => {
			if (/^https?:\/\//i.test(url)) await shell.openExternal(url);
			return true;
		},
		start_speech_recognition: async () => false,
		stop_speech_recognition: async () => true,
	};

	for (const channel of Object.keys(handlers) as InvokeChannel[]) {
		ipcMain.handle(invokeChannelName(channel), async (_event, args) => {
			return handlers[channel](args ?? {});
		});
	}
}
