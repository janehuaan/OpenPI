import { useEffect, useRef, useState } from "react";
import type {
	GeneratedImageItem,
	MediaCapabilities,
	VideoStatusResult,
} from "@openpi/shared";
import { api } from "../lib/api.ts";

type MediaTab = "image" | "video";

export function MediaView({ active }: { active: boolean }) {
	const [tab, setTab] = useState<MediaTab>("image");
	const [capabilities, setCapabilities] = useState<MediaCapabilities>();
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	useEffect(() => {
		if (!active) return;
		void api
			.mediaCapabilities()
			.then((caps) => {
				setCapabilities(caps);
				setError(undefined);
			})
			.catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
			.finally(() => setLoading(false));
	}, [active]);

	return (
		<section className="media-view">
			<header className="tasks-head">
				<h1>Media Generation</h1>
				<div className="view-tabs">
					<button
						type="button"
						className={tab === "image" ? "tab on" : "tab"}
						onClick={() => setTab("image")}
					>
						Image
					</button>
					<button
						type="button"
						className={tab === "video" ? "tab on" : "tab"}
						onClick={() => setTab("video")}
					>
						Video
					</button>
				</div>
			</header>

			{error ? <p className="error banner">{error}</p> : null}

			{loading ? (
				<p className="empty">Loading capabilities…</p>
			) : !capabilities?.configured ? (
				<div className="empty-state">
					<p>Agnes provider is not configured. Image and video generation require an Agnes API key.</p>
					<p className="hint">
						Configure an <code>agnes-cn</code> or <code>agnes</code> provider in <code>~/.openpi/agent/models.json</code> or set <code>AGNES_API_KEY</code>.
					</p>
				</div>
			) : tab === "image" ? (
				<ImageGenerator capabilities={capabilities} />
			) : (
				<VideoGenerator capabilities={capabilities} />
			)}
		</section>
	);
}

function ImageGenerator({ capabilities }: { capabilities: MediaCapabilities }) {
	const [prompt, setPrompt] = useState("");
	const [size, setSize] = useState<any>("2K");
	const [ratio, setRatio] = useState<any>("1:1");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [gallery, setGallery] = useState<GeneratedImageItem[]>([]);
	const [savedNotice, setSavedNotice] = useState<string>();

	const generate = async () => {
		if (!prompt.trim() || busy) return;
		setBusy(true);
		setError(undefined);
		setSavedNotice(undefined);
		try {
			const result = await api.generateImage({
				prompt: prompt.trim(),
				size,
				ratio,
			});
			if (result.images.length > 0) {
				setGallery((prev) => [...result.images, ...prev]);
			}
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setBusy(false);
		}
	};

	const saveImage = async (item: GeneratedImageItem) => {
		try {
			const res = await api.saveMedia({
				url: item.url,
				data: item.data,
				mimeType: item.mimeType ?? "image/png",
				filename: `openpi-image-${Date.now()}.png`,
			});
			if (res.filePath) setSavedNotice(`Saved to ${res.filePath}`);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	return (
		<div className="media-container">
			<div className="media-form">
				<label>
					Prompt
					<textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="Describe the image to generate…"
						rows={3}
					/>
				</label>

				<div className="media-controls">
					<label>
						Size
						<select value={size} onChange={(e) => setSize(e.target.value)}>
							{capabilities.sizes.map((s) => (
								<option key={s} value={s}>
									{s}
								</option>
							))}
						</select>
					</label>

					<label>
						Ratio
						<select value={ratio} onChange={(e) => setRatio(e.target.value)}>
							{capabilities.ratios.map((r) => (
								<option key={r} value={r}>
									{r}
								</option>
							))}
						</select>
					</label>

					<button
						type="button"
						className="primary"
						disabled={busy || !prompt.trim()}
						onClick={() => void generate()}
					>
						{busy ? "Generating…" : "Generate Image"}
					</button>
				</div>

				{error ? <p className="error">{error}</p> : null}
				{savedNotice ? <p className="hint banner">{savedNotice}</p> : null}
			</div>

			<div className="media-gallery">
				{gallery.length === 0 ? (
					<p className="empty">Generated images will appear here.</p>
				) : (
					<div className="image-grid">
						{gallery.map((item, index) => {
							const src = item.url ?? (item.data ? `data:${item.mimeType ?? "image/png"};base64,${item.data}` : "");
							return (
								<div key={index} className="media-card">
									<img src={src} alt={item.revisedPrompt ?? "Generated"} />
									<div className="media-card-actions">
										{item.revisedPrompt ? (
											<span className="media-caption" title={item.revisedPrompt}>
												{item.revisedPrompt}
											</span>
										) : null}
										<button type="button" onClick={() => void saveImage(item)}>
											Save Image…
										</button>
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

function VideoGenerator({ capabilities: _caps }: { capabilities: MediaCapabilities }) {
	const [prompt, setPrompt] = useState("");
	const [numFrames, setNumFrames] = useState(121); // 5s @ 24fps
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const [activeVideo, setActiveVideo] = useState<VideoStatusResult>();
	const [videoList, setVideoList] = useState<VideoStatusResult[]>([]);
	const [savedNotice, setSavedNotice] = useState<string>();

	const pollingRef = useRef<NodeJS.Timeout | undefined>(undefined);

	useEffect(() => {
		return () => {
			if (pollingRef.current) clearInterval(pollingRef.current);
		};
	}, []);

	const pollVideoStatus = (id: string) => {
		if (pollingRef.current) clearInterval(pollingRef.current);

		pollingRef.current = setInterval(async () => {
			try {
				const status = await api.getVideo(id);
				setActiveVideo(status);
				setVideoList((prev) => [status, ...prev.filter((v) => v.videoId !== status.videoId && v.taskId !== status.taskId)]);

				if (status.status === "completed" || status.status === "succeeded" || status.status === "failed") {
					clearInterval(pollingRef.current);
					pollingRef.current = undefined;
					setBusy(false);
				}
			} catch (caught) {
				console.error("poll error:", caught);
			}
		}, 4000);
	};

	const generate = async () => {
		if (!prompt.trim() || busy) return;
		setBusy(true);
		setError(undefined);
		setSavedNotice(undefined);

		try {
			const res = await api.createVideo({
				prompt: prompt.trim(),
				width: 1280,
				height: 720,
				numFrames,
				frameRate: 24,
			});
			setActiveVideo(res);
			setVideoList((prev) => [res, ...prev]);
			const idToPoll = res.taskId ?? res.videoId;
			pollVideoStatus(idToPoll);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
			setBusy(false);
		}
	};

	const saveVideo = async (item: VideoStatusResult) => {
		if (!item.url) return;
		try {
			const res = await api.saveMedia({
				url: item.url,
				mimeType: "video/mp4",
				filename: `openpi-video-${Date.now()}.mp4`,
			});
			if (res.filePath) setSavedNotice(`Saved to ${res.filePath}`);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	return (
		<div className="media-container">
			<div className="media-form">
				<label>
					Video Prompt
					<textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="Describe the video scene and motion…"
						rows={3}
					/>
				</label>

				<div className="media-controls">
					<label>
						Duration (Frames)
						<select value={numFrames} onChange={(e) => setNumFrames(Number(e.target.value))}>
							<option value={49}>49 frames (~2s)</option>
							<option value={97}>97 frames (~4s)</option>
							<option value={121}>121 frames (~5s)</option>
							<option value={145}>145 frames (~6s)</option>
						</select>
					</label>

					<button
						type="button"
						className="primary"
						disabled={busy || !prompt.trim()}
						onClick={() => void generate()}
					>
						{busy ? "Generating Video…" : "Generate Video"}
					</button>
				</div>

				{error ? <p className="error">{error}</p> : null}
				{savedNotice ? <p className="hint banner">{savedNotice}</p> : null}

				{activeVideo && (activeVideo.status === "queued" || activeVideo.status === "in_progress") ? (
					<div className="video-progress-card">
						<div className="progress-header">
							<span>Status: {activeVideo.status}</span>
							<span>{activeVideo.progress}%</span>
						</div>
						<div className="progress-bar-track">
							<div
								className="progress-bar-fill"
								style={{ width: `${Math.max(5, activeVideo.progress)}%` }}
							/>
						</div>
						<span className="hint">Generating video on Agnes platform, please wait…</span>
					</div>
				) : null}
			</div>

			<div className="media-gallery">
				{videoList.length === 0 ? (
					<p className="empty">Generated videos will appear here.</p>
				) : (
					<div className="video-grid">
						{videoList.map((item, idx) => (
							<div key={item.videoId || idx} className="media-card">
								{item.url ? (
									<video controls src={item.url} style={{ width: "100%", borderRadius: "4px" }} />
								) : (
									<div className="video-placeholder">
										<span>Status: {item.status} ({item.progress}%)</span>
										{item.error ? <span className="error">{item.error}</span> : null}
									</div>
								)}
								<div className="media-card-actions">
									<span className="media-caption">
										{item.size ? `${item.size} · ` : ""}{item.seconds ? `${item.seconds}s` : ""}
									</span>
									{item.url ? (
										<button type="button" onClick={() => void saveVideo(item)}>
											Save Video…
										</button>
									) : null}
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
