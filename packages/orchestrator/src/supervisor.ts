import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

import {
	type AgentSessionEvent,
	type AgentSessionEventListener,
	type RpcCommand,
	type RpcExtensionUIRequest,
	type RpcExtensionUIResponse,
	type RpcResponse,
	type SessionInfo,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { radiusPresence } from "./radius.ts";
import { createRpcProcessInstance, type RpcProcessInstance } from "./rpc-process.ts";
import { getInstance, loadInstances, removeInstance, saveInstances, upsertInstance } from "./storage.ts";
import type { AgentMode, InstanceRecord, InstanceStatus } from "./types.ts";

interface LiveInstanceResources {
	rpcProcess?: RpcProcessInstance;
	radiusPiId?: string;
	sessionId?: string;
}

interface LiveInstance {
	record: InstanceRecord;
	resources: LiveInstanceResources;
	subscribers: Set<AgentSessionEventListener>;
	onUiRequest?: (request: RpcExtensionUIRequest) => void;
	unsubscribeEvents?: () => void;
	unsubscribeExit?: () => void;
}

function cloneInstance(record: InstanceRecord): InstanceRecord {
	return { ...record, mode: record.mode === "code" ? "code" : "work" };
}

function sessionPathKey(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function sessionLabel(session: Pick<SessionInfo, "name" | "firstMessage">): string | undefined {
	const name = session.name?.trim();
	if (name) {
		return name;
	}
	const firstMessage = session.firstMessage.trim();
	return firstMessage ? firstMessage.slice(0, 80) : undefined;
}

// Only refresh persisted session metadata after commands that can plausibly change
// the instance identity/details we store in instances.json. Most RPCs mutate transient
// runtime state only, so forcing a follow-up get_state after every command is wasted IO.
//
// - new_session / switch_session / fork / clone can change sessionId/sessionFile
// - set_session_name changes a persisted session detail we may want reflected externally
// - prompt can materialize or advance persisted session state after the child processes it
const SESSION_METADATA_COMMANDS: ReadonlySet<RpcCommand["type"]> = new Set([
	"new_session",
	"switch_session",
	"fork",
	"clone",
	"set_session_name",
	"prompt",
]);

function shouldRefreshSessionMetadata(command: RpcCommand): boolean {
	return SESSION_METADATA_COMMANDS.has(command.type);
}

function isGetStateSuccess(
	response: RpcResponse,
): response is Extract<
	RpcResponse,
	{ success: true; command: "get_state"; data: { sessionId: string; sessionFile?: string } }
> {
	return response.success === true && response.command === "get_state" && "data" in response;
}

export class OrchestratorSupervisor {
	private readonly liveInstances = new Map<string, LiveInstance>();
	private readonly resumePromises = new Map<string, Promise<InstanceRecord | undefined>>();
	private sessionRefreshPromise: Promise<void> | undefined;
	private sessionIndexReady = false;

	private setStatus(live: LiveInstance, status: InstanceStatus): void {
		live.record = {
			...live.record,
			status,
			lastSeenAt: new Date().toISOString(),
		};
		upsertInstance(live.record);
	}

	private updateRecord(live: LiveInstance, updates: Partial<InstanceRecord>): void {
		live.record = {
			...live.record,
			...updates,
			lastSeenAt: new Date().toISOString(),
		};
		if (updates.radiusPiId !== undefined) {
			live.resources.radiusPiId = updates.radiusPiId;
		}
		if (updates.sessionId !== undefined) {
			live.resources.sessionId = updates.sessionId;
		}
		upsertInstance(live.record);
	}

	private clearBindings(live: LiveInstance): void {
		live.unsubscribeEvents?.();
		live.unsubscribeExit?.();
		live.unsubscribeEvents = undefined;
		live.unsubscribeExit = undefined;
		live.onUiRequest = undefined;
		live.resources.rpcProcess?.setUiRequestHandler(undefined);
	}

	private bindRpcProcess(live: LiveInstance, rpcProcess: RpcProcessInstance): void {
		this.clearBindings(live);
		live.resources.rpcProcess = rpcProcess;
		live.unsubscribeEvents = rpcProcess.onEvent((event) => {
			for (const subscriber of live.subscribers) {
				subscriber(event);
			}
		});
		live.unsubscribeExit = rpcProcess.onExit((error) => {
			void this.handleUnexpectedRpcExit(live, error);
		});
		rpcProcess.setUiRequestHandler((request) => {
			live.onUiRequest?.(request);
		});
	}

	private async handleUnexpectedRpcExit(live: LiveInstance, _error?: Error): Promise<void> {
		if (this.liveInstances.get(live.record.id) !== live) {
			return;
		}
		if (live.record.status === "stopping" || live.record.status === "stopped") {
			return;
		}
		this.setStatus(live, "error");
		this.clearBindings(live);
		live.resources.rpcProcess = undefined;
		if (live.resources.radiusPiId) {
			try {
				await radiusPresence.disconnectPi(live.record);
				this.updateRecord(live, { radiusPiId: undefined });
			} catch (error) {
				console.error(`Failed to disconnect Radius Pi ${live.record.id}: ${String(error)}`);
			}
		}
		this.liveInstances.delete(live.record.id);
	}

	private getRpcProcess(live: LiveInstance): RpcProcessInstance | undefined {
		return live.resources.rpcProcess;
	}

	private async syncInstanceRecord(live: LiveInstance): Promise<void> {
		const rpcProcess = this.getRpcProcess(live);
		if (!rpcProcess) {
			this.updateRecord(live, {});
			return;
		}
		const response = await rpcProcess.send({ type: "get_state" });
		if (!isGetStateSuccess(response)) {
			this.updateRecord(live, {});
			return;
		}
		this.updateRecord(live, {
			sessionId: response.data.sessionId,
			sessionFile: response.data.sessionFile,
			label: response.data.sessionName ?? live.record.label,
		});
	}

	private async cleanupAcquiredResources(live: LiveInstance): Promise<void> {
		const rpcProcess = live.resources.rpcProcess;
		this.clearBindings(live);
		if (live.resources.radiusPiId) {
			await radiusPresence.disconnectPi(live.record);
			live.resources.radiusPiId = undefined;
			live.record = {
				...live.record,
				radiusPiId: undefined,
				lastSeenAt: new Date().toISOString(),
			};
		}
		live.resources.sessionId = undefined;
		if (rpcProcess) {
			live.resources.rpcProcess = undefined;
			await rpcProcess.dispose();
		}
	}

	private async failSpawn(live: LiveInstance, error: unknown): Promise<never> {
		this.setStatus(live, "error");
		try {
			await this.cleanupAcquiredResources(live);
		} finally {
			this.liveInstances.delete(live.record.id);
			removeInstance(live.record.id);
		}
		throw error;
	}

	private async failResume(live: LiveInstance, error: unknown): Promise<never> {
		live.record = { ...live.record, autoResume: false };
		this.setStatus(live, "error");
		try {
			await this.cleanupAcquiredResources(live);
		} finally {
			this.liveInstances.delete(live.record.id);
		}
		throw error;
	}

	private createLiveInstance(record: InstanceRecord): LiveInstance {
		return {
			record,
			resources: {
				radiusPiId: record.radiusPiId,
				sessionId: record.sessionId,
			},
			subscribers: new Set(),
		};
	}

	private async activateInstance(live: LiveInstance, sessionFile?: string): Promise<InstanceRecord> {
		const rpcProcess = createRpcProcessInstance({ cwd: live.record.cwd, mode: live.record.mode, sessionFile });
		this.bindRpcProcess(live, rpcProcess);
		await this.syncInstanceRecord(live);
		const registeredRecord = await radiusPresence.registerPi(live.record);
		this.updateRecord(live, { radiusPiId: registeredRecord.radiusPiId });
		this.setStatus(live, "online");
		return cloneInstance(live.record);
	}

	private async resumeStoredInstance(instanceId: string): Promise<InstanceRecord | undefined> {
		const stored = getInstance(instanceId);
		if (!stored) {
			return undefined;
		}
		if (!stored.sessionFile || !existsSync(stored.sessionFile) || !isDirectory(stored.cwd)) {
			removeInstance(instanceId);
			return undefined;
		}

		const live = this.createLiveInstance({
			...stored,
			status: "starting",
			radiusPiId: undefined,
			autoResume: true,
			lastSeenAt: new Date().toISOString(),
		});
		this.liveInstances.set(instanceId, live);
		upsertInstance(live.record);
		try {
			return await this.activateInstance(live, stored.sessionFile);
		} catch (error) {
			return await this.failResume(live, error);
		}
	}

	private async suspendInstance(instanceId: string, autoResume: boolean): Promise<InstanceRecord | undefined> {
		const pendingResume = this.resumePromises.get(instanceId);
		if (pendingResume) {
			try {
				await pendingResume;
			} catch {
				// The failed resume already persisted its error state.
			}
		}

		const live = this.liveInstances.get(instanceId);
		if (!live) {
			const stored = getInstance(instanceId);
			if (!stored) {
				return undefined;
			}
			const stopped = {
				...stored,
				status: "stopped" as const,
				radiusPiId: undefined,
				autoResume,
				lastSeenAt: new Date().toISOString(),
			};
			upsertInstance(stopped);
			return cloneInstance(stopped);
		}

		this.setStatus(live, "stopping");
		try {
			await this.cleanupAcquiredResources(live);
		} finally {
			live.record = {
				...live.record,
				status: "stopped",
				radiusPiId: undefined,
				autoResume,
				lastSeenAt: new Date().toISOString(),
			};
			this.liveInstances.delete(instanceId);
			upsertInstance(live.record);
		}
		return cloneInstance(live.record);
	}

	updateInstance(instance: InstanceRecord): void {
		const live = this.liveInstances.get(instance.id);
		if (live) {
			live.record = instance;
			live.resources.radiusPiId = instance.radiusPiId;
			live.resources.sessionId = instance.sessionId;
		}
		upsertInstance(instance);
	}

	openRpcStream(
		instanceId: string,
		onEvent: (event: AgentSessionEvent) => void,
		onUiRequest: (request: RpcExtensionUIRequest) => void,
	):
		| {
				handleRpc(command: RpcCommand): Promise<RpcResponse>;
				handleUiResponse(response: RpcExtensionUIResponse): void;
				close(): void;
		  }
		| undefined {
		const live = this.liveInstances.get(instanceId);
		const rpcProcess = live ? this.getRpcProcess(live) : undefined;
		if (!live || !rpcProcess) {
			return undefined;
		}
		live.subscribers.add(onEvent);
		live.onUiRequest = onUiRequest;
		return {
			handleRpc: async (command) => {
				const response = await rpcProcess.send(command);
				if (shouldRefreshSessionMetadata(command)) {
					await this.syncInstanceRecord(live);
				}
				return response;
			},
			handleUiResponse: (response) => {
				rpcProcess.handleUiResponse(response);
			},
			close: () => {
				if (live.onUiRequest === onUiRequest) {
					live.onUiRequest = undefined;
				}
				live.subscribers.delete(onEvent);
			},
		};
	}

	getLiveInstance(instanceId: string): InstanceRecord | undefined {
		const live = this.liveInstances.get(instanceId);
		return live ? cloneInstance(live.record) : undefined;
	}

	listLiveInstances(): InstanceRecord[] {
		return [...this.liveInstances.values()].map((live) => cloneInstance(live.record));
	}

	private async refreshSessionIndex(): Promise<void> {
		const sessions = await SessionManager.listAllMetadata();
		const storedBySession = new Map<string, InstanceRecord>();
		const sessionlessLiveInstances: InstanceRecord[] = [];
		for (const instance of loadInstances()) {
			if (!instance.sessionFile) {
				if (this.liveInstances.has(instance.id)) {
					sessionlessLiveInstances.push(instance);
				}
				continue;
			}
			if (!existsSync(instance.sessionFile) || !isDirectory(instance.cwd)) {
				continue;
			}
			const key = sessionPathKey(instance.sessionFile);
			if (!storedBySession.has(key)) {
				storedBySession.set(key, instance);
			}
		}

		for (const session of sessions) {
			if (!existsSync(session.path) || !isDirectory(session.cwd)) {
				continue;
			}
			const key = sessionPathKey(session.path);
			const stored = storedBySession.get(key);
			if (stored) {
				storedBySession.set(key, {
					...stored,
					cwd: session.cwd,
					sessionId: session.id,
					sessionFile: session.path,
					label: sessionLabel(session) ?? stored.label,
				});
				continue;
			}
			storedBySession.set(key, {
				id: randomUUID(),
				status: "stopped",
				mode: "work",
				cwd: session.cwd,
				createdAt: session.created.toISOString(),
				lastSeenAt: session.modified.toISOString(),
				label: sessionLabel(session),
				sessionId: session.id,
				sessionFile: session.path,
				autoResume: false,
			});
		}
		saveInstances([...sessionlessLiveInstances, ...storedBySession.values()]);
	}

	async waitForSessionRefresh(): Promise<void> {
		await this.sessionRefreshPromise;
	}

	isSessionIndexReady(): boolean {
		return this.sessionIndexReady;
	}

	async recoverAfterRestart(): Promise<void> {
		const recoveredAt = new Date().toISOString();
		const storedBySession = new Map<string, InstanceRecord>();
		for (const instance of loadInstances()) {
			if (!instance.sessionFile || !existsSync(instance.sessionFile) || !isDirectory(instance.cwd)) {
				try {
					await radiusPresence.disconnectPi(instance);
				} catch (error) {
					console.error(`Failed to disconnect stale Radius Pi ${instance.id}: ${String(error)}`);
				}
				continue;
			}
			const key = sessionPathKey(instance.sessionFile);
			if (storedBySession.has(key)) {
				continue;
			}
			try {
				await radiusPresence.disconnectPi(instance);
			} catch (error) {
				console.error(`Failed to disconnect Radius Pi ${instance.id}: ${String(error)}`);
			}
			storedBySession.set(key, {
				...instance,
				status: "stopped",
				radiusPiId: undefined,
				autoResume: false,
				lastSeenAt: (() => {
					try {
						return statSync(instance.sessionFile).mtime.toISOString();
					} catch {
						return instance.lastSeenAt ?? recoveredAt;
					}
				})(),
			});
		}

		saveInstances([...storedBySession.values()]);

		this.sessionIndexReady = false;
		this.sessionRefreshPromise = this.refreshSessionIndex()
			.catch((error) => {
				console.error(`Failed to refresh Pi session index: ${String(error)}`);
			})
			.finally(() => {
				this.sessionIndexReady = true;
			});
	}

	listInstances(): InstanceRecord[] {
		return loadInstances().map(cloneInstance);
	}

	getInstance(instanceId: string): InstanceRecord | undefined {
		const live = this.liveInstances.get(instanceId);
		if (live) {
			return cloneInstance(live.record);
		}
		const stored = getInstance(instanceId);
		return stored ? cloneInstance(stored) : undefined;
	}

	async spawnInstance(options: { cwd: string; label?: string; mode: AgentMode }): Promise<InstanceRecord> {
		const now = new Date().toISOString();
		const live = this.createLiveInstance({
			id: randomUUID(),
			status: "starting",
			mode: options.mode,
			cwd: options.cwd,
			createdAt: now,
			lastSeenAt: now,
			label: options.label,
			autoResume: true,
		});
		this.liveInstances.set(live.record.id, live);
		upsertInstance(live.record);

		try {
			return await this.activateInstance(live);
		} catch (error) {
			return await this.failSpawn(live, error);
		}
	}

	async stopInstance(instanceId: string): Promise<InstanceRecord | undefined> {
		return this.suspendInstance(instanceId, false);
	}

	async resumeInstance(instanceId: string): Promise<InstanceRecord | undefined> {
		const live = this.liveInstances.get(instanceId);
		if (live) {
			return cloneInstance(live.record);
		}
		const pending = this.resumePromises.get(instanceId);
		if (pending) {
			return pending;
		}
		const resume = this.resumeStoredInstance(instanceId);
		this.resumePromises.set(instanceId, resume);
		try {
			return await resume;
		} finally {
			this.resumePromises.delete(instanceId);
		}
	}

	async renameInstance(instanceId: string, name: string): Promise<InstanceRecord | undefined> {
		const nextName = name.replace(/[\r\n]+/g, " ").trim();
		if (!nextName) {
			throw new Error("Session name cannot be empty");
		}

		const live = this.liveInstances.get(instanceId);
		if (live) {
			const rpcProcess = this.getRpcProcess(live);
			if (!rpcProcess) {
				return undefined;
			}
			const response = await rpcProcess.send({ type: "set_session_name", name: nextName });
			if (!response.success) {
				throw new Error(response.error);
			}
			this.updateRecord(live, { label: nextName });
			return cloneInstance(live.record);
		}

		const stored = getInstance(instanceId);
		if (!stored) {
			return undefined;
		}
		if (!stored.sessionFile || !existsSync(stored.sessionFile)) {
			removeInstance(instanceId);
			return undefined;
		}
		SessionManager.open(stored.sessionFile).appendSessionInfo(nextName);
		const renamed = { ...stored, label: nextName, lastSeenAt: new Date().toISOString() };
		upsertInstance(renamed);
		return cloneInstance(renamed);
	}

	async deleteInstance(instanceId: string): Promise<boolean> {
		const existing = this.getInstance(instanceId);
		if (!existing) {
			return false;
		}
		await this.suspendInstance(instanceId, false);
		if (existing.sessionFile && existsSync(existing.sessionFile)) {
			const session = SessionManager.open(existing.sessionFile);
			const header = session.getHeader();
			if (!header || header.id !== existing.sessionId || !existing.sessionFile.endsWith(".jsonl")) {
				throw new Error("Refusing to delete an unrecognized Pi session file");
			}
			unlinkSync(existing.sessionFile);
		}
		removeInstance(instanceId);
		return true;
	}

	async handleRpc(instanceId: string, command: RpcCommand): Promise<RpcResponse | undefined> {
		await this.resumeInstance(instanceId);
		const live = this.liveInstances.get(instanceId);
		const rpcProcess = live ? this.getRpcProcess(live) : undefined;
		if (!live || !rpcProcess) {
			return undefined;
		}

		const response = await rpcProcess.send(command);
		if (shouldRefreshSessionMetadata(command)) {
			await this.syncInstanceRecord(live);
		}
		return response;
	}

	async handleRpcBatch(instanceId: string, commands: RpcCommand[]): Promise<RpcResponse[] | undefined> {
		await this.resumeInstance(instanceId);
		const live = this.liveInstances.get(instanceId);
		const rpcProcess = live ? this.getRpcProcess(live) : undefined;
		if (!live || !rpcProcess) {
			return undefined;
		}

		const responses = await Promise.all(commands.map((command) => rpcProcess.send(command)));
		if (commands.some(shouldRefreshSessionMetadata)) {
			await this.syncInstanceRecord(live);
		}
		return responses;
	}

	async shutdown(): Promise<void> {
		for (const instanceId of [...this.liveInstances.keys()]) {
			try {
				await this.suspendInstance(instanceId, true);
			} catch (error) {
				console.error(`Failed to suspend Pi instance ${instanceId}: ${String(error)}`);
			}
		}
	}
}

export const supervisor = new OrchestratorSupervisor();

radiusPresence.setCoordinator({
	getLiveInstance(instanceId) {
		return supervisor.getLiveInstance(instanceId);
	},
	listLiveInstances() {
		return supervisor.listLiveInstances();
	},
	updateInstance(instance) {
		supervisor.updateInstance(instance);
	},
});
