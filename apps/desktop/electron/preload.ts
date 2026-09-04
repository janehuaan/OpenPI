/**
 * Preload: the renderer's only route to the outside.
 *
 * `contextIsolation` is on and `nodeIntegration` off, so the renderer sees
 * exactly what is exposed here and nothing else. The channel allowlist comes
 * from `channels.ts`, the same list the main process registers handlers from.
 */

import { contextBridge, ipcRenderer } from "electron";
import {
	EVENT_CHANNELS,
	eventChannelName,
	INVOKE_CHANNELS,
	invokeChannelName,
	type EventChannel,
	type InvokeChannel,
} from "./channels.ts";

const allowedInvoke = new Set<string>(INVOKE_CHANNELS);
const allowedEvents = new Set<string>(EVENT_CHANNELS);

contextBridge.exposeInMainWorld("openpi", {
	isNative: true,

	invoke(channel: string, args?: unknown): Promise<unknown> {
		if (!allowedInvoke.has(channel)) {
			return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
		}
		return ipcRenderer.invoke(invokeChannelName(channel as InvokeChannel), args);
	},

	/** Subscribe to a push channel; returns the unsubscribe function. */
	on(channel: string, handler: (payload: unknown) => void): () => void {
		if (!allowedEvents.has(channel)) {
			throw new Error(`Blocked IPC event channel: ${channel}`);
		}
		const listener = (_event: unknown, payload: unknown) => handler(payload);
		const name = eventChannelName(channel as EventChannel);
		ipcRenderer.on(name, listener);
		return () => ipcRenderer.removeListener(name, listener);
	},
});
