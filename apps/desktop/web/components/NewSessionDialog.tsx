import { useEffect, useState } from "react";
import type { ModelOption, SessionMode } from "@openpi/shared";
import { api } from "../lib/api.ts";
import { shortenPath } from "../lib/paths.ts";

interface Props {
	open: boolean;
	onClose: () => void;
	onCreate: (input: { cwd: string; mode: SessionMode; model?: string; name?: string }) => void;
}

export function NewSessionDialog({ open, onClose, onCreate }: Props) {
	const [cwd, setCwd] = useState("");
	const [mode, setMode] = useState<SessionMode>("chat");
	const [model, setModel] = useState("");
	const [name, setName] = useState("");
	const [models, setModels] = useState<ModelOption[]>([]);
	const [recent, setRecent] = useState<string[]>([]);

	useEffect(() => {
		if (!open) return;
		void (async () => {
			// Load in parallel: neither depends on the other, and the dialog should
			// not stall on the slower one.
			const [modelsResult, workspaceResult, recentResult] = await Promise.all([
				api.listModels().catch(() => ({ models: [] })),
				api.defaultWorkspace().catch(() => ({ cwd: "" })),
				api.recentWorkspaces().catch(() => ({ cwds: [] })),
			]);
			setModels(modelsResult.models);
			setRecent(recentResult.cwds);
			setCwd((current) => current || workspaceResult.cwd);
		})();
	}, [open]);

	if (!open) return null;

	const browse = async () => {
		const result = await api.selectWorkspace(cwd || undefined).catch(() => ({ cwd: undefined }));
		if (result.cwd) setCwd(result.cwd);
	};

	const submit = () => {
		if (!cwd.trim()) return;
		onCreate({ cwd: cwd.trim(), mode, model: model || undefined, name: name.trim() || undefined });
	};

	return (
		<div className="dialog-backdrop" role="presentation" onClick={onClose}>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close only */}
			<div className="dialog" role="dialog" aria-label="New session" onClick={(event) => event.stopPropagation()}>
				<h2>New session</h2>

				<label>
					Workspace
					<div className="row">
						<input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/path/to/project" />
						<button type="button" onClick={browse}>
							Browse…
						</button>
					</div>
				</label>

				{recent.length > 0 ? (
					<div className="recent">
						{recent.map((path) => (
							<button key={path} type="button" className="chip" onClick={() => setCwd(path)} title={path}>
								{shortenPath(path, 32)}
							</button>
						))}
					</div>
				) : null}

				<label>
					Mode
					<select value={mode} onChange={(event) => setMode(event.target.value as SessionMode)}>
						<option value="chat">chat — default tools</option>
						<option value="code">code — file and shell tools</option>
					</select>
				</label>

				<label>
					Model
					<select value={model} onChange={(event) => setModel(event.target.value)}>
						<option value="">(daemon default)</option>
						{models.map((option) => (
							<option key={option.ref} value={option.ref}>
								{option.ref}
							</option>
						))}
					</select>
				</label>

				<label>
					Name <span className="hint">optional</span>
					<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nightly review" />
				</label>

				<footer className="dialog-actions">
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button type="button" className="primary" onClick={submit} disabled={!cwd.trim()}>
						Create
					</button>
				</footer>
			</div>
		</div>
	);
}
