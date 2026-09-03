/**
 * Unix socket server.
 *
 * Every connection is long-lived and fully multiplexed: requests correlate by
 * `id`, events push with none. There is no second socket type and no special
 * request that switches a connection into streaming mode - that split is what
 * made the old implementation keep connection handling in two places.
 *
 * The socket carries no authentication of its own; filesystem permissions on
 * ~/.openpi/daemon.sock are the access control, so it is created 0600.
 */

import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import {
	type ClientRequest,
	decodeLines,
	encodeMessage,
	type PiRpcEvent,
	type ServerMessage,
} from "@openpi/shared";
import { socketPath } from "../config.ts";

export type RequestHandler = (request: ClientRequest, connection: Connection) => Promise<unknown>;

export interface Connection {
	send(message: ServerMessage): void;
	pushEvent(sessionId: string, event: PiRpcEvent): void;
	/** Unsubscribe callbacks to run when this connection closes. */
	cleanups: Set<() => void>;
}

export function startServer(handler: RequestHandler): Promise<Server> {
	const path = socketPath();
	// A stale socket file from a hard kill would make bind fail; the caller has
	// already established that no live daemon owns it.
	if (existsSync(path)) unlinkSync(path);

	const server = createServer((socket: Socket) => {
		socket.setEncoding("utf8");
		let buffer = "";

		const connection: Connection = {
			send(message) {
				if (!socket.destroyed) socket.write(encodeMessage(message));
			},
			pushEvent(sessionId, event) {
				if (!socket.destroyed) socket.write(encodeMessage({ type: "event", sessionId, event }));
			},
			cleanups: new Set(),
		};

		socket.on("data", (chunk: string) => {
			const { messages, rest, errors } = decodeLines(buffer, chunk);
			buffer = rest;
			// One unparseable request must not discard the valid ones sent alongside it.
			for (const error of errors) {
				connection.send({ id: "", type: "response", ok: false, error: `bad frame: ${error}` });
			}
			for (const message of messages) {
				void handleRequest(message as ClientRequest, connection, handler);
			}
		});

		socket.on("error", () => socket.destroy());
		socket.on("close", () => {
			for (const cleanup of connection.cleanups) cleanup();
			connection.cleanups.clear();
		});
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(path, () => {
			chmodSync(path, 0o600);
			server.removeListener("error", reject);
			resolve(server);
		});
	});
}

/**
 * Requests are handled concurrently rather than queued. Each one either targets
 * a distinct session or is an app-level read, and the pending-id map in
 * RpcProcess already keeps per-session responses correlated.
 */
async function handleRequest(request: ClientRequest, connection: Connection, handler: RequestHandler): Promise<void> {
	const id = typeof request?.id === "string" ? request.id : "";
	try {
		const data = await handler(request, connection);
		connection.send({ id, type: "response", ok: true, data: data ?? null });
	} catch (error) {
		connection.send({
			id,
			type: "response",
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
