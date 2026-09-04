import { useEffect, useState } from "react";
import type { MemoryEntry, MemoryScope, WorkspaceSummary } from "@openpi/shared";
import { api } from "../lib/api.ts";

interface Props {
	cwd?: string;
}

/**
 * Workspace facts and the memory index for the selected session.
 *
 * Read-only for now: memory writes have a tool and a daemon op, but a UI that
 * edits the index needs conflict handling against a session writing the same
 * file, and that is not built yet.
 */
export function ContextPanel({ cwd }: Props) {
	const [summary, setSummary] = useState<WorkspaceSummary>();
	const [scope, setScope] = useState<MemoryScope>("project");
	const [entries, setEntries] = useState<MemoryEntry[]>([]);
	const [openKey, setOpenKey] = useState<string>();
	const [body, setBody] = useState("");

	useEffect(() => {
		if (!cwd) {
			setSummary(undefined);
			setEntries([]);
			return;
		}
		let cancelled = false;
		void (async () => {
			const [summaryResult, memoryResult] = await Promise.all([
				api.workspaceSummary(cwd).catch(() => undefined),
				api.listMemory(cwd, scope).catch(() => ({ entries: [] })),
			]);
			if (cancelled) return;
			setSummary(summaryResult);
			setEntries(memoryResult.entries);
		})();
		return () => {
			cancelled = true;
		};
	}, [cwd, scope]);

	const openTopic = async (entry: MemoryEntry) => {
		if (!cwd) return;
		const key = `${entry.type}/${entry.key}`;
		if (openKey === key) {
			setOpenKey(undefined);
			return;
		}
		setOpenKey(key);
		const result = await api.readMemoryTopic(cwd, entry.type, entry.key, scope).catch(() => ({ body: "" }));
		setBody(result.body);
	};

	if (!cwd) return <aside className="context" />;

	return (
		<aside className="context">
			<h2>Workspace</h2>
			{summary ? (
				<dl className="facts">
					<dt>Path</dt>
					<dd title={summary.cwd}>{summary.cwd}</dd>
					<dt>Git</dt>
					<dd>{summary.isGitRepo ? (summary.branch ?? "yes") : "no"}</dd>
					<dt>Entries</dt>
					<dd>{summary.fileCount}</dd>
				</dl>
			) : (
				<p className="empty">No workspace facts.</p>
			)}

			<h2>
				Memory
				<span className="scope-toggle">
					{(["project", "global"] as MemoryScope[]).map((option) => (
						<button
							key={option}
							type="button"
							className={option === scope ? "chip on" : "chip"}
							onClick={() => setScope(option)}
						>
							{option}
						</button>
					))}
				</span>
			</h2>

			{entries.length === 0 ? (
				<p className="empty">Nothing saved yet.</p>
			) : (
				<ul className="memory-list">
					{entries.map((entry) => {
						const key = `${entry.type}/${entry.key}`;
						return (
							<li key={key}>
								<button type="button" className="memory" onClick={() => void openTopic(entry)}>
									<span className={`badge ${entry.type}`}>{entry.type}</span>
									<span className="memory-key">{entry.key}</span>
									<span className="memory-value">{entry.value}</span>
								</button>
								{openKey === key && body ? <pre className="memory-body">{body}</pre> : null}
							</li>
						);
					})}
				</ul>
			)}
		</aside>
	);
}
