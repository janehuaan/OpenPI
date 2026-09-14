import { useEffect, useState } from "react";
import { X } from "../../icons";
import type { ImageContent } from "../../../types";

export function MessageImages({ images }: { images: ImageContent[] }) {
	const [activePreview, setActivePreview] = useState<string | null>(null);

	useEffect(() => {
		if (!activePreview) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setActivePreview(null);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [activePreview]);

	if (!images || images.length === 0) return null;

	const isSingle = images.length === 1;

	return (
		<>
			<div className={`message-images ${isSingle ? "single-image" : "multi-image"}`}>
				{images.map((image, index) => {
					const src = `data:${image.mimeType};base64,${image.data}`;
					return (
						<div
							key={`${image.mimeType}-${image.data.length}-${index}`}
							className="message-image-wrapper"
							onClick={() => setActivePreview(src)}
							title="点击查看大图"
						>
							<img
								src={src}
								alt={`Attachment ${index + 1}`}
								className="message-image"
								loading="lazy"
							/>
							<div className="image-zoom-hint">点击放大</div>
						</div>
					);
				})}
			</div>

			{activePreview && (
				<div
					className="image-lightbox-overlay"
					onClick={() => setActivePreview(null)}
					role="dialog"
					aria-modal="true"
					aria-label="图片预览"
				>
					<div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
						<img src={activePreview} alt="Preview" className="image-lightbox-img" />
						<button
							type="button"
							className="image-lightbox-close"
							onClick={() => setActivePreview(null)}
							title="关闭预览 (Esc)"
							aria-label="关闭预览"
						>
							<X size={18} />
						</button>
					</div>
				</div>
			)}
		</>
	);
}
