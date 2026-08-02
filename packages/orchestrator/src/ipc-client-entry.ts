#!/usr/bin/env node
import { sendIpcRequest } from "./ipc/client.ts";
import type { OrchestratorRequest } from "./ipc/protocol.ts";

const requestJson = process.argv[2];
if (!requestJson) {
	throw new Error("Usage: ipc-client-entry <json-request>");
}

const request = JSON.parse(requestJson) as OrchestratorRequest;
const response = await sendIpcRequest(request);
process.stdout.write(JSON.stringify(response));
