/**
 * Preload: exposes the openpi bridge matching the complete desktop contract.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
	INVOKE_CHANNELS,
	invokeChannelName,
	type InvokeChannel,
} from "./channels.ts";

const allowedInvoke = new Set<string>(INVOKE_CHANNELS);

contextBridge.exposeInMainWorld("openpi", {
	isNative: true,

	invoke(channel: string, args?: unknown): Promise<unknown> {
		if (typeof channel !== "string" || !allowedInvoke.has(channel)) {
			return Promise.reject(new Error(`Blocked IPC channel: ${String(channel)}`));
		}
		return ipcRenderer.invoke(invokeChannelName(channel as InvokeChannel), args);
	},

	onConversationEvent(handler: (payload: { instanceId: string; event: unknown }) => void): () => void {
		const listener = (_event: unknown, payload: unknown) =>
			handler(payload as { instanceId: string; event: unknown });
		ipcRenderer.on("openpi:conversation-event", listener);
		return () => ipcRenderer.removeListener("openpi:conversation-event", listener);
	},

	onRefreshData(handler: () => void): () => void {
		const listener = () => handler();
		ipcRenderer.on("openpi:refresh-data", listener);
		return () => ipcRenderer.removeListener("openpi:refresh-data", listener);
	},

	onSpeechEvent(handler: (event: unknown) => void): () => void {
		const listener = (_event: unknown, payload: unknown) => handler(payload);
		ipcRenderer.on("openpi:speech-event", listener);
		return () => ipcRenderer.removeListener("openpi:speech-event", listener);
	},

	onDaemonRestartDeferred(handler: () => void): () => void {
		const listener = () => handler();
		ipcRenderer.on("openpi:daemon-restart-deferred", listener);
		return () => ipcRenderer.removeListener("openpi:daemon-restart-deferred", listener);
	},
});
