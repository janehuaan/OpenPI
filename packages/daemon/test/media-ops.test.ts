/**
 * media-ops coverage: configuration resolution, input validation,
 * response normalization, and error handling for image & video generation.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach, beforeEach } from "node:test";
import {
	AGNES_IMAGE_MODEL,
	AGNES_IMAGE_RATIOS,
	AGNES_IMAGE_SIZES,
	AGNES_VIDEO_MODEL,
	createVideo,
	generateImage,
	getVideo,
	mediaCapabilities,
	resolveAgnesConfig,
} from "../src/media-ops.ts";

let root: string;
let previousDir: string | undefined;
let previousKey: string | undefined;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
	previousDir = process.env.OPENPI_DIR;
	previousKey = process.env.AGNES_API_KEY;
	originalFetch = globalThis.fetch;
	delete process.env.AGNES_API_KEY;
	root = mkdtempSync(join(tmpdir(), "openpi-media-"));
	process.env.OPENPI_DIR = root;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (previousDir === undefined) delete process.env.OPENPI_DIR;
	else process.env.OPENPI_DIR = previousDir;
	if (previousKey === undefined) delete process.env.AGNES_API_KEY;
	else process.env.AGNES_API_KEY = previousKey;
	rmSync(root, { recursive: true, force: true });
});

function writeModelsJson(providers: Record<string, unknown>) {
	const dir = join(root, "agent");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "models.json"), JSON.stringify({ providers }), "utf8");
}

test("resolveAgnesConfig reads apiKey and baseUrl from models.json", () => {
	writeModelsJson({
		"agnes-cn": { apiKey: "test-key-123", baseUrl: "https://api.agnes-ai.cn/v1" },
	});
	const config = resolveAgnesConfig();
	assert.ok(config);
	assert.equal(config.apiKey, "test-key-123");
	assert.equal(config.baseUrl, "https://api.agnes-ai.cn/v1");
});

test("resolveAgnesConfig falls back to AGNES_API_KEY env var", () => {
	process.env.AGNES_API_KEY = "env-key-456";
	const config = resolveAgnesConfig();
	assert.ok(config);
	assert.equal(config.apiKey, "env-key-456");
	assert.equal(config.baseUrl, "https://api.agnes-ai.cn");
});

test("resolveAgnesConfig returns undefined when neither models.json nor env is set", () => {
	assert.equal(resolveAgnesConfig(), undefined);
});

test("mediaCapabilities reports correct model and dimension constants", () => {
	writeModelsJson({
		"agnes-cn": { apiKey: "k" },
	});
	const caps = mediaCapabilities();
	assert.equal(caps.configured, true);
	assert.equal(caps.imageModel, AGNES_IMAGE_MODEL);
	assert.equal(caps.videoModel, AGNES_VIDEO_MODEL);
	assert.deepEqual(caps.sizes, [...AGNES_IMAGE_SIZES]);
	assert.deepEqual(caps.ratios, [...AGNES_IMAGE_RATIOS]);
});

test("generateImage validates prompt, size and ratio", async () => {
	writeModelsJson({ "agnes-cn": { apiKey: "k" } });

	await assert.rejects(() => generateImage({ prompt: "" }), /prompt is required/);
	await assert.rejects(
		() => generateImage({ prompt: "cat", size: "8K" as any }),
		/Unsupported image size/,
	);
	await assert.rejects(
		() => generateImage({ prompt: "cat", ratio: "5:4" as any }),
		/Unsupported image ratio/,
	);
});

test("generateImage sends request and extracts url images", async () => {
	writeModelsJson({ "agnes-cn": { apiKey: "test-key", baseUrl: "https://mock.agnes.test/v1" } });

	let requestedUrl = "";
	let requestedBody: any;
	let authHeader = "";

	globalThis.fetch = async (url, init) => {
		requestedUrl = String(url);
		const headers = (init?.headers ?? {}) as Record<string, string>;
		authHeader = headers["Authorization"] ?? "";
		requestedBody = JSON.parse(String(init?.body));
		return new Response(
			JSON.stringify({
				created: 123456,
				data: [{ url: "https://cdn.test/cat.png", revised_prompt: "a fluffy cat" }],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	const result = await generateImage({ prompt: "a cat", size: "2K", ratio: "16:9" });

	assert.equal(requestedUrl, "https://mock.agnes.test/v1/images/generations");
	assert.equal(authHeader, "Bearer test-key");
	assert.equal(requestedBody.model, AGNES_IMAGE_MODEL);
	assert.equal(requestedBody.size, "2K");
	assert.equal(requestedBody.ratio, "16:9");
	assert.equal(result.images.length, 1);
	assert.equal(result.images[0]?.url, "https://cdn.test/cat.png");
	assert.equal(result.images[0]?.revisedPrompt, "a fluffy cat");
});

test("generateImage extracts base64 images when response_format is b64_json", async () => {
	writeModelsJson({ "agnes-cn": { apiKey: "test-key", baseUrl: "https://mock.agnes.test/v1" } });

	globalThis.fetch = async () =>
		new Response(
			JSON.stringify({
				data: [{ b64_json: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" }],
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);

	const result = await generateImage({ prompt: "logo", returnBase64: true });
	assert.equal(result.images.length, 1);
	assert.equal(result.images[0]?.mimeType, "image/png");
	assert.equal(result.images[0]?.data, "iVBORw0KGgoAAAANSUhEUg==");
});

test("createVideo validates prompt and 8n + 1 frame rule", async () => {
	writeModelsJson({ "agnes-cn": { apiKey: "k" } });

	await assert.rejects(() => createVideo({ prompt: "" }), /prompt is required/);
	await assert.rejects(
		() => createVideo({ prompt: "run", numFrames: 120 }),
		/8n \+ 1 rule/,
	);
});

test("createVideo posts request and normalizes response", async () => {
	writeModelsJson({ "agnes-cn": { apiKey: "test-key", baseUrl: "https://mock.agnes.test" } });

	let requestedBody: any;
	globalThis.fetch = async (_url, init) => {
		requestedBody = JSON.parse(String(init?.body));
		return new Response(
			JSON.stringify({
				task_id: "task-abc",
				video_id: "vid-123",
				status: "queued",
				progress: 0,
				created_at: 1700000000,
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	};

	const result = await createVideo({
		prompt: "flying bird",
		width: 1280,
		height: 720,
		numFrames: 121,
	});

	assert.equal(requestedBody.model, AGNES_VIDEO_MODEL);
	assert.equal(requestedBody.num_frames, 121);
	assert.equal(result.taskId, "task-abc");
	assert.equal(result.videoId, "vid-123");
	assert.equal(result.status, "queued");
	assert.equal(result.progress, 0);
});

test("getVideo queries and normalizes video status", async () => {
	writeModelsJson({ "agnes-cn": { apiKey: "test-key", baseUrl: "https://mock.agnes.test" } });

	globalThis.fetch = async (url) => {
		if (String(url).includes("/v1/videos/task-abc")) {
			return new Response(
				JSON.stringify({
					id: "task-abc",
					video_id: "vid-123",
					status: "completed",
					progress: 100,
					metadata: { url: "https://cdn.test/bird.mp4" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		}
		return new Response("not found", { status: 404 });
	};

	const status = await getVideo("task-abc");
	assert.equal(status.status, "completed");
	assert.equal(status.progress, 100);
	assert.equal(status.url, "https://cdn.test/bird.mp4");
});
