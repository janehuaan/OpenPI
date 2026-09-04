import { useEffect, useState } from "react";
import type { CreateTaskInput, ModelOption } from "@openpi/shared";
import { api } from "../lib/api.ts";
import { CRON_PRESETS, describeCron, toRunAtIso, validateCron } from "../lib/cron.ts";

interface Props {
	open: boolean;
	onClose: () => void;
	onCreate: (input: CreateTaskInput) => void;
}

type Kind = "cron" | "once";

export function CreateTaskDialog({ open, onClose, onCreate }: Props) {
	const [title, setTitle] = useState("");
	const [prompt, setPrompt] = useState("");
	const [cwd, setCwd] = useState("");
	const [model, setModel] = useState("");
	const [kind, setKind] = useState<Kind>("cron");
	const [expression, setExpression] = useState(CRON_PRESETS[0]!.expression);
	const [runAt, setRunAt] = useState("");
	const [models, setModels] = useState<ModelOption[]>([]);

	useEffect(() => {
		if (!open) return;
		void (async () => {
			const [modelsResult, workspaceResult] = await Promise.all([
				api.listModels().catch(() => ({ models: [] })),
				api.defaultWorkspace().catch(() => ({ cwd: "" })),
			]);
			setModels(modelsResult.models);
			setCwd((current) => current || workspaceResult.cwd);
		})();
	}, [open]);

	if (!open) return null;

	// Validate here so a bad expression never reaches the daemon, where the
	// scheduler would throw and surface as an opaque IPC error.
	const cronError = kind === "cron" ? validateCron(expression) : undefined;
	const runAtIso = kind === "once" ? toRunAtIso(runAt) : undefined;
	const scheduleError = kind === "once" && runAt && !runAtIso ? "Pick a valid date and time." : cronError;
	const ready = Boolean(title.trim() && prompt.trim() && !scheduleError && (kind === "cron" || runAtIso));

	const submit = () => {
		if (!ready) return;
		onCreate({
			title: title.trim(),
			prompt: prompt.trim(),
			cwd: cwd.trim() || undefined,
			model: model || undefined,
			schedule: kind === "cron" ? { kind: "cron", expression: expression.trim() } : { kind: "once", runAt: runAtIso! },
			// Unattended runs get a read-mostly tool set from the scheduler's own
			// default; nothing here widens it.
		});
	};

	const browse = async () => {
		const result = await api.selectWorkspace(cwd || undefined).catch(() => ({ cwd: undefined }));
		if (result.cwd) setCwd(result.cwd);
	};

	return (
		<div className="dialog-backdrop" role="presentation" onClick={onClose}>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close only */}
			<div className="dialog wide" role="dialog" aria-label="New task" onClick={(event) => event.stopPropagation()}>
				<h2>New scheduled task</h2>

				<label>
					Title
					<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Nightly review" />
				</label>

				<label>
					Prompt
					<textarea
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						rows={3}
						placeholder="Review yesterday's commits and summarize anything that needs attention."
					/>
				</label>

				<label>
					Workspace <span className="hint">the task's working directory</span>
					<div className="row">
						<input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/path/to/project" />
						<button type="button" onClick={browse}>
							Browse…
						</button>
					</div>
				</label>

				<label>
					Schedule
					<div className="row">
						{(["cron", "once"] as Kind[]).map((option) => (
							<button
								key={option}
								type="button"
								className={option === kind ? "chip on" : "chip"}
								onClick={() => setKind(option)}
							>
								{option === "cron" ? "Repeating" : "Once"}
							</button>
						))}
					</div>
				</label>

				{kind === "cron" ? (
					<>
						<div className="recent">
							{CRON_PRESETS.map((preset) => (
								<button
									key={preset.expression}
									type="button"
									className={preset.expression === expression ? "chip on" : "chip"}
									onClick={() => setExpression(preset.expression)}
								>
									{preset.label}
								</button>
							))}
						</div>
						<label>
							Cron expression
							<input
								value={expression}
								onChange={(event) => setExpression(event.target.value)}
								placeholder="7 9 * * *"
								spellCheck={false}
							/>
						</label>
						<p className={cronError ? "error" : "hint"}>{cronError ?? describeCron(expression)}</p>
					</>
				) : (
					<label>
						Run at
						<input type="datetime-local" value={runAt} onChange={(event) => setRunAt(event.target.value)} />
					</label>
				)}

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

				<footer className="dialog-actions">
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button type="button" className="primary" onClick={submit} disabled={!ready}>
						Create
					</button>
				</footer>
			</div>
		</div>
	);
}
