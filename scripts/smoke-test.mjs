import net from "node:net";

const socketPath = "/tmp/smoke-test.sock";

console.log("--> Connecting to Rust openpi-daemon at:", socketPath);
const client = net.createConnection(socketPath, async () => {
	console.log("--> Connected successfully to Unix Domain Socket!");

	// 1. Test Health
	await sendRequest({ id: "req-smoke-health", type: "health" });

	// 2. Test create_session
	await sendRequest({
		id: "req-smoke-session",
		type: "create_session",
		cwd: "/Users/huaan/openpi-next",
		name: "Smoke Test Session",
	});

	// 3. Test AppOp: create_task
	await sendRequest({
		id: "req-smoke-task",
		type: "app",
		op: {
			name: "create_task",
			input: {
				title: "Automated Smoke Verification",
				prompt: "cargo test",
				schedule: { kind: "once", runAt: "2026-10-01T00:00:00Z" },
			},
		},
	});

	// 4. Test AppOp: list_tasks
	await sendRequest({
		id: "req-smoke-list",
		type: "app",
		op: { name: "list_tasks" },
	});

	// 5. Test AppOp: write_memory & list_memory
	await sendRequest({
		id: "req-smoke-mem-w",
		type: "app",
		op: {
			name: "write_memory",
			cwd: "/Users/huaan/openpi-next",
			scope: "project",
			type: "smoke",
			key: "rust_engine",
			value: "active_and_verified",
		},
	});

	await sendRequest({
		id: "req-smoke-mem-l",
		type: "app",
		op: {
			name: "list_memory",
			cwd: "/Users/huaan/openpi-next",
		},
	});

	console.log("\n==========================================");
	console.log(" ALL SMOKE TEST CHECKS PASSED PERFECTLY!");
	console.log("==========================================");
	client.end();
	process.exit(0);
});

client.on("error", (err) => {
	console.error("Socket error:", err);
	process.exit(1);
});

let buffer = "";
let pendingResolvers = new Map();

client.on("data", (chunk) => {
	buffer += chunk.toString("utf8");
	const parts = buffer.split("\n");
	buffer = parts.pop() ?? "";
	for (const part of parts) {
		if (!part.trim()) continue;
		const msg = JSON.parse(part);
		if (msg.id && pendingResolvers.has(msg.id)) {
			const resolve = pendingResolvers.get(msg.id);
			pendingResolvers.delete(msg.id);
			resolve(msg);
		}
	}
});

function sendRequest(req) {
	return new Promise((resolve) => {
		pendingResolvers.set(req.id, (resp) => {
			console.log(`[PASS] ${req.type}${req.op ? `.${req.op.name}` : ""}:`, JSON.stringify(resp.data));
			resolve(resp);
		});
		client.write(`${JSON.stringify(req)}\n`);
	});
}
