import { api } from "../lib/api.ts";
import { type Block, type Inline, parseMarkdown } from "../lib/markdown.ts";

/**
 * Render assistant text as markdown.
 *
 * Builds React elements from a token list — model output never reaches
 * `innerHTML`, so there is no sanitizer on the message path.
 */
export function Markdown({ text }: { text: string }) {
	return (
		<div className="markdown">
			{parseMarkdown(text).map((block, index) => (
				<BlockView key={index} block={block} />
			))}
		</div>
	);
}

function BlockView({ block }: { block: Block }) {
	switch (block.kind) {
		case "fence":
			return (
				<pre className="code-block">
					{block.language ? <span className="code-lang">{block.language}</span> : null}
					<code>{block.text}</code>
				</pre>
			);
		case "heading": {
			const Tag = `h${Math.min(block.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6";
			return (
				<Tag>
					<Spans spans={block.spans} />
				</Tag>
			);
		}
		case "bullet":
			return (
				<div className="md-item">
					<span className="md-marker">•</span>
					<span>
						<Spans spans={block.spans} />
					</span>
				</div>
			);
		case "numbered":
			return (
				<div className="md-item">
					<span className="md-marker">{block.marker}.</span>
					<span>
						<Spans spans={block.spans} />
					</span>
				</div>
			);
		default:
			return (
				<p>
					<Spans spans={block.spans} />
				</p>
			);
	}
}

function Spans({ spans }: { spans: Inline[] }) {
	return (
		<>
			{spans.map((span, index) => {
				switch (span.kind) {
					case "code":
						return (
							<code key={index} className="inline-code">
								{span.text}
							</code>
						);
					case "strong":
						return <strong key={index}>{span.text}</strong>;
					case "link":
						return (
							<button
								key={index}
								type="button"
								className="md-link"
								// Opening in the system browser, never a new Electron window.
								onClick={() => void api.openExternal(span.href).catch(() => undefined)}
								title={span.href}
							>
								{span.text}
							</button>
						);
					default:
						return <span key={index}>{span.text}</span>;
				}
			})}
		</>
	);
}
