/**
 * Tauri IPC bridge adapter for OpenPI desktop.
 * Maps window.openpi to Tauri v2's native invoke and event listener APIs.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

function safeListen(eventName: string, handler: (payload: any) => void): () => void {
	let isDisposed = false;
	let unlistenFn: (() => void) | undefined;

	listen(eventName, (event: any) => {
		if (!isDisposed) {
			handler(event.payload);
		}
	})
		.then((fn) => {
			if (isDisposed) {
				setTimeout(() => {
					try {
						fn();
					} catch {}
				}, 0);
			} else {
				unlistenFn = fn;
			}
		})
		.catch(() => {});

	return () => {
		isDisposed = true;
		if (unlistenFn) {
			const fn = unlistenFn;
			unlistenFn = undefined;
			setTimeout(() => {
				try {
					fn();
				} catch {}
			}, 0);
		}
	};
}

if (typeof window !== "undefined") {
	window.onerror = (msg, url, line, col, error) => {
		invoke("openpi_invoke", {
			channel: "log_error",
			args: { msg: String(msg), url: String(url), line, col, stack: error?.stack },
		}).catch(() => {});
	};

	window.addEventListener("unhandledrejection", (event) => {
		const reasonStr = String(event.reason?.message || event.reason || "");
		if (reasonStr.includes("listeners[eventId]") || reasonStr.includes("unregisterListener") || reasonStr.includes("start_dragging")) {
			event.preventDefault();
			return;
		}
		invoke("openpi_invoke", {
			channel: "log_error",
			args: { reason: reasonStr, stack: event.reason?.stack },
		}).catch(() => {});
	});

	invoke("openpi_invoke", { channel: "log_info", args: { message: "tauri-bridge initialized" } }).catch(() => {});

	(window as any).openpi = {
		isNative: true,
		platform: "darwin",

		invoke: async (channel: string, args?: unknown): Promise<unknown> => {
			return await invoke("openpi_invoke", { channel, args: args ?? {} });
		},

		onConversationEvent: (handler: (payload: { instanceId: string; event: unknown }) => void): (() => void) => {
			return safeListen("openpi:conversation-event", handler);
		},

		onRefreshData: (handler: () => void): (() => void) => {
			return safeListen("openpi:refresh-data", () => handler());
		},

		onSpeechEvent: (handler: (event: any) => void): (() => void) => {
			return safeListen("openpi:speech-event", handler);
		},

		onDaemonRestartDeferred: (handler: () => void): (() => void) => {
			return safeListen("openpi:daemon-restart-deferred", () => handler());
		},

		onDaemonStatus: (handler: (status: "connected" | "reconnecting" | "disconnected") => void): (() => void) => {
			return safeListen("openpi:daemon-status", handler);
		},

		onNavigate: (handler: (view: string, extra?: unknown) => void): (() => void) => {
			return safeListen("openpi:navigate", (payload: any) => {
				handler(payload?.view, payload?.extra);
			});
		},

		onSelectConversation: (handler: (instanceId: string) => void): (() => void) => {
			return safeListen("openpi:select-conversation", (payload: any) => {
				if (payload?.instanceId) handler(payload.instanceId);
			});
		},

		onNewConversation: (handler: () => void): (() => void) => {
			return safeListen("openpi:new-conversation", () => handler());
		},

		onComposerPrefill: (handler: (draft: { text: string; images?: string[] }) => void): (() => void) => {
			return safeListen("openpi:composer-prefill", handler);
		},

		onSendMessage: (handler: (payload: { text: string; images?: any[] }) => void): (() => void) => {
			return safeListen("openpi:send-message", handler);
		},

		onAutoPilotEvent: (handler: (payload: any) => void): (() => void) => {
			return safeListen("openpi:autopilot-event", handler);
		},

		onRuntimeUpdateProgress: (handler: (progress: any) => void): (() => void) => {
			return safeListen("openpi:runtime-update-progress", handler);
		},
	};
}
