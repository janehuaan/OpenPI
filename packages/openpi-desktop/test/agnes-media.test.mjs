import { describe, expect, it, vi } from "vitest";
import { AGNES_IMAGE_MODEL, AGNES_VIDEO_MODEL, createAgnesMediaClient } from "../electron/agnes-media.mjs";

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("Agnes media client", () => {
	it("generates URL images with response_format inside extra_body", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ created: 1780000000, data: [{ url: "https://cdn.example/image.png" }] }),
		);
		const client = createAgnesMediaClient({ apiKey: "test-key", fetchImpl });

		const result = await client.generateImage({ prompt: "A quiet library", size: "2K", ratio: "16:9" });

		expect(result.images).toEqual([{ url: "https://cdn.example/image.png", revisedPrompt: undefined }]);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe("https://apihub.agnes-ai.com/v1/images/generations");
		expect(init.headers.Authorization).toBe("Bearer test-key");
		expect(JSON.parse(init.body)).toEqual({
			model: AGNES_IMAGE_MODEL,
			prompt: "A quiet library",
			size: "2K",
			ratio: "16:9",
			extra_body: { response_format: "url" },
		});
	});

	it("normalizes Base64 image output", async () => {
		const client = createAgnesMediaClient({
			apiKey: "test-key",
			fetchImpl: async () => jsonResponse({ data: [{ b64_json: "data:image/webp;base64,ZmFrZQ==" }] }),
		});

		const result = await client.generateImage({ prompt: "A red circle", returnBase64: true });

		expect(result.images).toEqual([{ data: "ZmFrZQ==", mimeType: "image/webp", revisedPrompt: undefined }]);
	});

	it("creates and polls video tasks using video_id", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse({ task_id: "task-1", video_id: "video-1", status: "queued", progress: 0 }))
			.mockResolvedValueOnce(
				jsonResponse({
					task_id: "task-1",
					video_id: "video-1",
					status: "completed",
					progress: 100,
					metadata: { url: "https://cdn.example/video.mp4" },
				}),
			);
		const client = createAgnesMediaClient({ apiKey: "test-key", fetchImpl });

		const created = await client.createVideo({ prompt: "Ocean waves", numFrames: 121, frameRate: 24 });
		const completed = await client.getVideo(created.videoId);

		expect(created).toMatchObject({ model: AGNES_VIDEO_MODEL, taskId: "task-1", videoId: "video-1" });
		expect(completed).toMatchObject({ status: "completed", url: "https://cdn.example/video.mp4" });
		expect(fetchImpl.mock.calls[1][0]).toBe("https://apihub.agnes-ai.com/agnesapi?video_id=video-1");
	});

	it("rejects invalid frame counts and surfaces provider errors", async () => {
		const client = createAgnesMediaClient({
			apiKey: "test-key",
			fetchImpl: async () => jsonResponse({ error: { message: "quota exceeded" } }, 429),
		});

		await expect(client.createVideo({ prompt: "test", numFrames: 120 })).rejects.toThrow("8n + 1");
		await expect(client.generateImage({ prompt: "test" })).rejects.toThrow("quota exceeded");
	});
});
