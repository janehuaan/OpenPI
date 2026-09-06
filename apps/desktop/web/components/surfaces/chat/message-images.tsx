import type { ImageContent } from "../../../types";

export function MessageImages({ images }: { images: ImageContent[] }) {
	return (
		<div className="message-images">
			{images.map((image, index) => (
				<img
					key={`${image.mimeType}-${image.data.length}-${index}`}
					src={`data:${image.mimeType};base64,${image.data}`}
					alt={`Attachment ${index + 1}`}
					className="message-image"
					loading="lazy"
				/>
			))}
		</div>
	);
}
