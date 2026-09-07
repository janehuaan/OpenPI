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
	platform: process.platform,

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

	onDaemonStatus(handler: (status: "connected" | "reconnecting" | "disconnected") => void): () => void {
		const listener = (_event: unknown, payload: unknown) =>
			handler(payload as "connected" | "reconnecting" | "disconnected");
		ipcRenderer.on("openpi:daemon-status", listener);
		return () => ipcRenderer.removeListener("openpi:daemon-status", listener);
	},

	onNavigate(handler: (view: string, extra?: unknown) => void): () => void {
		const listener = (_event: unknown, view: unknown, extra?: unknown) =>
			handler(String(view), extra);
		ipcRenderer.on("openpi:navigate", listener);
		return () => ipcRenderer.removeListener("openpi:navigate", listener);
	},

	onNewConversation(handler: () => void): () => void {
		const listener = () => handler();
		ipcRenderer.on("openpi:new-conversation", listener);
		return () => ipcRenderer.removeListener("openpi:new-conversation", listener);
	},

	onComposerPrefill(handler: (draft: { text: string; images?: string[] }) => void): () => void {
		const listener = (_event: unknown, payload: unknown) =>
			handler(payload as { text: string; images?: string[] });
		ipcRenderer.on("openpi:composer-prefill", listener);
		return () => ipcRenderer.removeListener("openpi:composer-prefill", listener);
	},
});
