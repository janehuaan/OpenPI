/**
 * Tests for session-scoped task-list injection.
 *
 * `<cwd>/.pi/todos/current.json` is shared by every session in a directory, so
 * the injection must be keyed to the session that wrote the list — otherwise an
 * abandoned list is prepended to every new conversation in that directory.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentMessage } from "../src/core/agent-session.ts";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { saveTodoState } from "../src/core/tools/todo.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

type InjectableSession = { _maybeInjectContext(messages: AgentMessage[]): AgentMessage[] };

const TODOS = [
	{ content: "download the model", status: "completed" as const },
	{ content: "benchmark the model", status: "in_progress" as const },
];

describe("AgentSession task-list injection", () => {
	let session: AgentSession;
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-todo-inject-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		session?.dispose();
		if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
	});

	async function createSession(): Promise<AgentSession> {
		const model = getModel("openai", "gpt-5.6-luna")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Test", tools: [] },
		});
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = await createModelRegistry(authStorage, tempDir);
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(tempDir),
			settingsManager,
			cwd: tempDir,
			modelRuntime: getModelRuntime(modelRegistry),
			resourceLoader: createTestResourceLoader(),
		});
		return session;
	}

	function inject(target: AgentSession): AgentMessage[] {
		const prompt: AgentMessage = { role: "user", content: "hello", timestamp: Date.now() };
		return (target as unknown as InjectableSession)._maybeInjectContext([prompt]);
	}

	it("injects the task list into the session that wrote it", async () => {
		const target = await createSession();
		saveTodoState(tempDir, { updatedAt: new Date().toISOString(), sessionId: target.sessionId, todos: TODOS });

		const messages = inject(target);
		const injected = messages[0] as { content: string };

		expect(messages).toHaveLength(2);
		expect(injected.content).toContain("## Current task list");
		expect(injected.content).toContain("benchmark the model");
	});

	it("does not leak a list left behind by another session in the same cwd", async () => {
		const target = await createSession();
		saveTodoState(tempDir, {
			updatedAt: new Date().toISOString(),
			sessionId: "01a0432f-4028-7ed8-8222-5fe9c03efbee",
			todos: TODOS,
		});

		expect(inject(target)).toHaveLength(1);
	});

	it("ignores a list with no session id", async () => {
		const target = await createSession();
		saveTodoState(tempDir, { updatedAt: new Date().toISOString(), todos: TODOS });

		expect(inject(target)).toHaveLength(1);
	});

	it("stops injecting once every item is completed", async () => {
		const target = await createSession();
		saveTodoState(tempDir, {
			updatedAt: new Date().toISOString(),
			sessionId: target.sessionId,
			todos: TODOS.map((item) => ({ ...item, status: "completed" as const })),
		});

		expect(inject(target)).toHaveLength(1);
	});
});
