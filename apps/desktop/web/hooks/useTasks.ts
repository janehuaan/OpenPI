import { useCallback, useEffect, useState } from "react";
import type { CreateTaskInput, TaskWithRuns } from "@openpi/shared";
import { api } from "../lib/api.ts";

/**
 * Scheduled tasks, polled while the view is open.
 *
 * Polling rather than pushing: a run's status changes in a subprocess the daemon
 * watches, and there is no event channel for it. Ten seconds is slow enough to
 * be cheap and fast enough that a manual run visibly lands.
 */
export function useTasks(active: boolean) {
	const [tasks, setTasks] = useState<TaskWithRuns[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string>();

	const refresh = useCallback(async () => {
		try {
			const { tasks: next } = await api.listTasks();
			setTasks(next);
			setError(undefined);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!active) return;
		void refresh();
		const timer = setInterval(() => void refresh(), 10_000);
		return () => clearInterval(timer);
	}, [active, refresh]);

	const create = useCallback(
		async (input: CreateTaskInput) => {
			try {
				await api.createTask(input);
				await refresh();
				return true;
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
				return false;
			}
		},
		[refresh],
	);

	const act = useCallback(
		async (run: () => Promise<unknown>) => {
			try {
				await run();
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : String(caught));
			}
			await refresh();
		},
		[refresh],
	);

	return {
		tasks,
		loading,
		error,
		refresh,
		create,
		setPaused: (taskId: string, paused: boolean) => act(() => api.setTaskPaused(taskId, paused)),
		remove: (taskId: string) => act(() => api.deleteTask(taskId)),
		runNow: (taskId: string) => act(() => api.runTask(taskId)),
		cancel: (runId: string) => act(() => api.cancelRun(runId)),
	};
}
