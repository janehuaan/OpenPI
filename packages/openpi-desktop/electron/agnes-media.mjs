const DEFAULT_BASE_URL = "https://apihub.agnes-ai.com";

export const AGNES_IMAGE_MODEL = "agnes-image-2.1-flash";
export const AGNES_VIDEO_MODEL = "agnes-video-v2.0";
export const AGNES_IMAGE_SIZES = Object.freeze(["1K", "2K", "3K", "4K"]);
export const AGNES_IMAGE_RATIOS = Object.freeze(["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"]);

function requiredString(value, name) {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
	return value.trim();
}

function optionalInteger(value, name, min, max) {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new Error(`${name} must be an integer from ${min} to ${max}`);
	}
	return value;
}

function parseDataUri(value) {
	if (typeof value !== "string") return undefined;
	const match = value.match(/^data:([^;]+);base64,(.+)$/);
	if (!match) return { data: value, mimeType: "image/png" };
	return { data: match[2], mimeType: match[1] };
}

function errorMessage(payload, status) {
	if (typeof payload === "string" && payload.trim()) return payload.trim();
	if (payload && typeof payload === "object") {
		if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
		if (typeof payload.detail === "string" && payload.detail.trim()) return payload.detail.trim();
		if (typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
		if (payload.error && typeof payload.error === "object" && typeof payload.error.message === "string") {
			return payload.error.message;
		}
	}
	return `Agnes request failed (${status})`;
}

async function readResponse(response) {
	const text = await response.text();
	if (!text) return {};
	try {
		return JSON.parse(text);
	} catch {
		if (!response.ok) throw new Error(errorMessage(text, response.status));
		throw new Error("Agnes returned an invalid JSON response");
	}
}

export function createAgnesMediaClient({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = globalThis.fetch } = {}) {
	const key = requiredString(apiKey, "Agnes API key");
	if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");
	const root = baseUrl.replace(/\/+$/, "");

	async function request(path, init, timeoutMs) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetchImpl(`${root}${path}`, {
				...init,
				headers: {
					Authorization: `Bearer ${key}`,
					"Content-Type": "application/json",
					...init?.headers,
				},
				signal: controller.signal,
			});
			const payload = await readResponse(response);
			if (!response.ok) throw new Error(errorMessage(payload, response.status));
			return payload;
		} catch (error) {
			if (controller.signal.aborted) throw new Error("Agnes request timed out");
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		async generateImage(input) {
			const prompt = requiredString(input?.prompt, "prompt");
			const size = input?.size ?? "2K";
			const ratio = input?.ratio ?? "1:1";
			if (!AGNES_IMAGE_SIZES.includes(size)) throw new Error(`Unsupported image size: ${size}`);
			if (!AGNES_IMAGE_RATIOS.includes(ratio)) throw new Error(`Unsupported image ratio: ${ratio}`);

			const responseFormat = input?.returnBase64 ? "b64_json" : "url";
			const extraBody = { response_format: responseFormat };
			if (Array.isArray(input?.images) && input.images.length > 0) {
				extraBody.image = input.images.map((image) => requiredString(image, "image"));
			}
			const payload = await request(
				"/v1/images/generations",
				{
					method: "POST",
					body: JSON.stringify({
						model: AGNES_IMAGE_MODEL,
						prompt,
						size,
						ratio,
						...(input?.returnBase64 ? { return_base64: true } : {}),
						extra_body: extraBody,
					}),
				},
				input?.timeoutMs ?? 10 * 60_000,
			);
			const data = Array.isArray(payload?.data) ? payload.data : [];
			const images = data.flatMap((item) => {
				if (!item || typeof item !== "object") return [];
				if (typeof item.url === "string" && item.url.trim()) {
					return [{ url: item.url.trim(), revisedPrompt: item.revised_prompt ?? undefined }];
				}
				const parsed = parseDataUri(item.b64_json);
				return parsed ? [{ ...parsed, revisedPrompt: item.revised_prompt ?? undefined }] : [];
			});
			if (images.length === 0) throw new Error("Agnes returned no generated image");
			return {
				model: AGNES_IMAGE_MODEL,
				created: typeof payload.created === "number" ? payload.created : undefined,
				images,
			};
		},

		async createVideo(input) {
			const prompt = requiredString(input?.prompt, "prompt");
			const width = optionalInteger(input?.width ?? 1280, "width", 1, 4096);
			const height = optionalInteger(input?.height ?? 720, "height", 1, 4096);
			const numFrames = optionalInteger(input?.numFrames ?? 121, "numFrames", 1, 441);
			const frameRate = optionalInteger(input?.frameRate ?? 24, "frameRate", 1, 60);
			if ((numFrames - 1) % 8 !== 0) throw new Error("numFrames must follow the 8n + 1 rule");

			const payload = await request(
				"/v1/videos",
				{
					method: "POST",
					body: JSON.stringify({
						model: AGNES_VIDEO_MODEL,
						prompt,
						width,
						height,
						num_frames: numFrames,
						frame_rate: frameRate,
						...(input?.image ? { image: requiredString(input.image, "image") } : {}),
						...(input?.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
						...(Number.isInteger(input?.seed) ? { seed: input.seed } : {}),
					}),
				},
				input?.timeoutMs ?? 120_000,
			);
			return normalizeVideo(payload);
		},

		async getVideo(videoId, options = {}) {
			const id = requiredString(videoId, "videoId");
			const payload = await request(
				`/agnesapi?video_id=${encodeURIComponent(id)}`,
				{ method: "GET" },
				options.timeoutMs ?? 60_000,
			);
			return normalizeVideo(payload);
		},
	};
}

function normalizeVideo(payload) {
	if (!payload || typeof payload !== "object") throw new Error("Agnes returned an invalid video response");
	const taskId = typeof payload.task_id === "string" ? payload.task_id : typeof payload.id === "string" ? payload.id : undefined;
	const videoId = typeof payload.video_id === "string" ? payload.video_id : undefined;
	if (!taskId && !videoId) throw new Error("Agnes video response is missing task_id and video_id");
	return {
		model: typeof payload.model === "string" ? payload.model : AGNES_VIDEO_MODEL,
		taskId,
		videoId: videoId ?? taskId,
		status: typeof payload.status === "string" ? payload.status : "queued",
		progress: typeof payload.progress === "number" ? payload.progress : 0,
		createdAt: typeof payload.created_at === "number" ? payload.created_at : undefined,
		completedAt: typeof payload.completed_at === "number" ? payload.completed_at : undefined,
		seconds: typeof payload.seconds === "string" || typeof payload.seconds === "number" ? String(payload.seconds) : undefined,
		size: typeof payload.size === "string" ? payload.size : undefined,
		url: typeof payload.metadata?.url === "string" ? payload.metadata.url : undefined,
		sizeMapping: payload.metadata?.size_mapping,
		error: payload.error ?? undefined,
	};
}
