import { useMemo, useState } from "react";
import { Check, Copy } from "./icons.tsx";
import { parseDiffLines } from "../lib/diff";

export function MiniDiffView({
	diffText,
	filename,
}: {
	diffText: string;
	filename?: string;
}) {
	const [copied, setCopied] = useState(false);

	const { lines, adds, dels } = useMemo(() => parseDiffLines(diffText), [diffText]);

	const handleCopy = () => {
		void navigator.clipboard.writeText(diffText).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	};

	return (
		<div className="mini-diff-viewer" role="region" aria-label="代码变更对比">
			<div className="mini-diff-header">
				<div className="mini-diff-info">
					{filename && <span className="mini-diff-filename" title={filename}>{filename}</span>}
					<span className="mini-diff-stats">
						{adds > 0 && <span className="stat-add">+{adds}</span>}
						{dels > 0 && <span className="stat-del">-{dels}</span>}
					</span>
				</div>
				<button
					type="button"
					className="mini-diff-copy-btn"
					onClick={handleCopy}
					title="复制完整 Diff 内容"
				>
					{copied ? (
						<>
							<Check size={11} className="copy-ok" />
							<span>已复制</span>
						</>
					) : (
						<>
							<Copy size={11} />
							<span>复制 Diff</span>
						</>
					)}
				</button>
			</div>
			<div className="mini-diff-body">
				{lines.map((line, idx) => {
					if (line.type === "header") {
						return (
							<div className="diff-row diff-row-header" key={`diff-${idx}`}>
								<span className="diff-col-num" />
								<span className="diff-col-num" />
								<span className="diff-col-sign"> </span>
								<span className="diff-col-code">{line.content}</span>
							</div>
						);
					}
					if (line.type === "hunk") {
						return (
							<div className="diff-row diff-row-hunk" key={`diff-${idx}`}>
								<span className="diff-col-num">…</span>
								<span className="diff-col-num">…</span>
								<span className="diff-col-sign"> </span>
								<span className="diff-col-code">{line.content}</span>
							</div>
						);
					}
					return (
						<div
							className={`diff-row diff-row-${line.type}`}
							key={`diff-${idx}`}
						>
							<span className="diff-col-num">{line.oldLineNo ?? ""}</span>
							<span className="diff-col-num">{line.newLineNo ?? ""}</span>
							<span className="diff-col-sign">
								{line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
							</span>
							<span className="diff-col-code">{line.content}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
