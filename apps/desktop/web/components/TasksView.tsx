import { useState } from "react";
import type { TaskRunSummary, TaskWithRuns } from "@openpi/shared";
import { api } from "../lib/api.ts";
import { describeCron } from "../lib/cron.ts";
import { CreateTaskDialog } from "./CreateTaskDialog.tsx";
import { useTasks } from "../hooks/useTasks.ts";

export function TasksView({ active }: { active: boolean }) {
	const tasks = useTasks(active);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [openLog, setOpenLog] = useState<{ runId: string; text: string; truncated: boolean }>();

	const showLog = async (run: TaskRunSummary) => {
		if (openLog?.runId === run.id) {
			setOpenLog(undefined);
			return;
		}
		const log = await api.readRunLog(run.id, "stdout").catch(() => ({ text: "", truncated: false }));
		setOpenLog({ runId: run.id, ...log });
	};

	return (
		<section className="tasks">
			<header className="tasks-head">
				<h1>Scheduled tasks</h1>
				<button type="button" className="primary" onClick={() => setDialogOpen(true)}>
					New task
				</button>
			</header>

			{tasks.error ? <p className="error banner">{tasks.error}</p> : null}

			{tasks.loading ? (
				<p className="empty">Loading…</p>
			) : tasks.tasks.length === 0 ? (
				<p className="empty">No scheduled tasks. A task runs pi unattended on a cron or at one time.</p>
			) : (
				<ul className="task-list">
					{tasks.tasks.map(({ task, runs }) => (
						<li key={task.id} className="task">
							<div className="task-row">
								<div className="task-info">
									<span className="task-title">
										{task.title}
										{task.status === "paused" ? <span className="badge paused">paused</span> : null}
									</span>
									<span className="task-schedule">
										{task.schedule.kind === "cron"
											? describeCron(task.schedule.expression)
											: `Once at ${formatTime(task.schedule.runAt)}`}
										{task.nextRunAt && task.status === "active" ? ` · next ${formatTime(task.nextRunAt)}` : ""}
									</span>
									<span className="task-prompt">{task.prompt}</span>
									{task.cwd ? (
										<span className="task-cwd" title={task.cwd}>
											{task.cwd}
											{task.model ? ` · ${task.model}` : ""}
										</span>
									) : null}
								</div>
								<div className="task-actions">
									<button type="button" onClick={() => void tasks.runNow(task.id)}>
										Run now
									</button>
									<button type="button" onClick={() => void tasks.setPaused(task.id, task.status === "active")}>
										{task.status === "active" ? "Pause" : "Resume"}
									</button>
									<button type="button" onClick={() => void tasks.remove(task.id)}>
										Delete
									</button>
								</div>
							</div>

							{task.steps && task.steps.length > 0 ? (
								<div className="task-steps">
									{task.steps.map((step) => (
										<span key={step.id} className="tool-chip">
											{step.title}
											{step.dependsOn && step.dependsOn.length > 0 ? ` ← ${step.dependsOn.join(", ")}` : ""}
										</span>
									))}
								</div>
							) : null}

							{runs.length > 0 ? (
								<ul className="run-list">
									{runs.slice(0, 5).map((run) => (
										<li key={run.id}>
											<button type="button" className="run" onClick={() => void showLog(run)}>
												<span className={`run-status ${run.status}`}>{run.status}</span>
												<span className="run-time">{formatTime(run.startedAt ?? run.createdAt)}</span>
												<span className="run-trigger">{run.trigger}</span>
												{run.attempt && run.attempt > 1 ? (
													<span className="run-attempt">attempt {run.attempt}</span>
												) : null}
												{run.error ? <span className="run-error">{run.error}</span> : null}
											</button>
											{run.status === "running" || run.status === "queued" ? (
												<button type="button" className="run-cancel" onClick={() => void tasks.cancel(run.id)}>
													Cancel
												</button>
											) : null}
											{openLog?.runId === run.id ? (
												<pre className="run-log">
													{openLog.truncated ? "… (tail)\n" : ""}
													{openLog.text || "(no output)"}
												</pre>
											) : null}
										</li>
									))}
								</ul>
							) : null}
						</li>
					))}
				</ul>
			)}

			<CreateTaskDialog
				open={dialogOpen}
				onClose={() => setDialogOpen(false)}
				onCreate={async (input) => {
					if (await tasks.create(input)) setDialogOpen(false);
				}}
			/>
		</section>
	);
}

function formatTime(iso: string | undefined): string {
	if (!iso) return "—";
	const timestamp = Date.parse(iso);
	if (!Number.isFinite(timestamp)) return iso;
	return new Date(timestamp).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
