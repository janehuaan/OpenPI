#!/usr/bin/env node
/**
 * openpi-daemon CLI. Thin wrapper over the daemon and its client - useful for
 * development and for the smoke tests; the desktop app talks to the socket
 * directly rather than shelling out to this.
 */

import { DaemonClient, isDaemonLive } from "./ipc/client.ts";
import { serve } from "./serve.ts";

const USAGE = `openpi-daemon - session daemon for openpi

Usage:
  openpi-daemon serve                       Run the daemon in the foreground
  openpi-daemon health                      Print daemon health as JSON
  openpi-daemon list                        List sessions
  openpi-daemon create <cwd> [--mode code] [--model p/m]
  openpi-daemon rpc <sessionId> <json>      Forward one RPC command to a session
  openpi-daemon watch <sessionId>           Stream a session's events
  openpi-daemon stop <sessionId>            Suspend a session's process
  openpi-daemon auth                        Show provider status
  openpi-daemon import-credentials          Re-import providers from ~/.pi/agent
  openpi-daemon shutdown                    Stop the daemon
`;

function flagValue(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

async function withClient<T>(run: (client: DaemonClient) => Promise<T>): Promise<T> {
	const client = new DaemonClient();
	await client.connect();
	try {
		return await run(client);
	} finally {
		client.close();
	}
}

function printJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(argv: string[]): Promise<number> {
	const [command, ...args] = argv;

	switch (command) {
		case "serve":
			await serve();
			return -1; // keep the process alive

		case "health":
			printJson(await withClient((client) => client.request({ type: "health" })));
			return 0;

		case "list":
			printJson(await withClient((client) => client.request({ type: "list_sessions" })));
			return 0;

		case "create": {
			const cwd = args[0];
			if (!cwd) {
				process.stderr.write("create requires a cwd\n");
				return 1;
			}
			const mode = flagValue(args, "--mode") === "code" ? "code" : "chat";
			printJson(
				await withClient((client) =>
					client.request({ type: "create_session", cwd, mode, model: flagValue(args, "--model") }),
				),
			);
			return 0;
		}

		case "rpc": {
			const sessionId = args[0];
			const json = args[1];
			if (!sessionId || !json) {
				process.stderr.write("rpc requires <sessionId> <json>\n");
				return 1;
			}
			printJson(
				await withClient((client) =>
					client.request({ type: "rpc", sessionId, command: JSON.parse(json) }),
				),
			);
			return 0;
		}

		case "watch": {
			const sessionId = args[0];
			if (!sessionId) {
				process.stderr.write("watch requires <sessionId>\n");
				return 1;
			}
			const client = new DaemonClient();
			await client.connect();
			client.onEvent((id, event) => printJson({ sessionId: id, event }));
			await client.request({ type: "subscribe", sessionId });
			process.stderr.write(`watching ${sessionId}; Ctrl+C to stop\n`);
			return -1;
		}

		case "stop": {
			const sessionId = args[0];
			if (!sessionId) {
				process.stderr.write("stop requires <sessionId>\n");
				return 1;
			}
			printJson(await withClient((client) => client.request({ type: "stop_session", sessionId })));
			return 0;
		}

		case "auth":
			printJson(await withClient((client) => client.request({ type: "app", op: { name: "auth_status" } })));
			return 0;

		case "import-credentials":
			printJson(
				await withClient((client) =>
					client.request({ type: "app", op: { name: "import_global_credentials" } }),
				),
			);
			return 0;

		case "shutdown":
			if (!(await isDaemonLive())) {
				process.stderr.write("no daemon running\n");
				return 0;
			}
			printJson(await withClient((client) => client.request({ type: "shutdown" })));
			return 0;

		default:
			process.stdout.write(USAGE);
			return command ? 1 : 0;
	}
}

const code = await main(process.argv.slice(2)).catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	return 1;
});
if (code >= 0) process.exit(code);
