/**
 * Minimal client for talking to a running daemon.
 *
 * Used by the CLI subcommands and by tests. The desktop app will use the same
 * shape from the Electron main process.
 */

import { randomUUID } from "node:crypto";
import { connect, type Socket } from "node:net";
import {
	type ClientRequest,
	type ClientRequestInput,
	decodeLines,
	encodeMessage,
	type PiRpcEvent,
	type ServerMessage,
} from "@openpi/shared";
import { socketPath } from "./../config.ts";

export type EventHandler = (sessionId: string, event: PiRpcEvent) => void;

export class DaemonClient {
	private socket: Socket | undefined;
	private buffer = "";
	private readonly pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private readonly eventHandlers = new Set<EventHandler>();
	private readonly closeHandlers = new Set<() => void>();

	isConnected(): boolean {
		return this.socket !== undefined && !this.socket.destroyed;
	}

	onClose(handler: () => void): () => void {
		this.closeHandlers.add(handler);
		return () => this.closeHandlers.delete(handler);
	}

	connect(timeoutMs = 5000): Promise<void> {
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
			socket.on("error", (error) => {
				clearTimeout(timer);
				if (!this.socket) {
					reject(error);
				}
				for (const [, pending] of this.pending) pending.reject(error);
				this.pending.clear();
			});
			socket.on("data", (chunk: string) => this.handleChunk(chunk));
			socket.on("close", () => {
				for (const [, pending] of this.pending) pending.reject(new Error("daemon connection closed"));
				this.pending.clear();
				this.socket = undefined;
				for (const handler of this.closeHandlers) {
					try {
						handler();
					} catch {}
				}
			});
		});
	}

	onEvent(handler: EventHandler): () => void {
		this.eventHandlers.add(handler);
		return () => this.eventHandlers.delete(handler);
	}

	request(request: ClientRequestInput, timeoutMs = 130_000): Promise<unknown> {
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
				},
			});
			socket.write(encodeMessage({ ...request, id } as ClientRequest), (err) => {
				if (err) {
					clearTimeout(timer);
					this.pending.delete(id);
					reject(err);
				}
			});
		});
	}

	close(): void {
		this.socket?.end();
		this.socket = undefined;
	}

	private handleChunk(chunk: string): void {
		const { messages, rest } = decodeLines(this.buffer, chunk);
		this.buffer = rest;
		for (const raw of messages) {
			const message = raw as ServerMessage;
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
}

/** True when a daemon is listening and answering on the socket. */
export async function isDaemonLive(): Promise<boolean> {
	const client = new DaemonClient();
	try {
		await client.connect(1500);
		await client.request({ type: "health" }, 3000);
		client.close();
		return true;
	} catch {
		client.close();
		return false;
	}
}
