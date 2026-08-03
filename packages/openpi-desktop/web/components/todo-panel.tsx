import { useState } from "react";
import type { TodoState } from "../types";

function numberPrefix(state: TodoState, index: number): string {
	let topIndex = 0;
	let subIndex = 0;
	for (let i = 0; i <= index; i++) {
		if (state.todos[i].level !== 1) {
			topIndex += 1;
			subIndex = 0;
		} else {
			subIndex += 1;
		}
	}
	return state.todos[index].level === 1 ? `${topIndex}.${subIndex}.` : `${topIndex}.`;
}

export function TodoPanel({ state }: { state: TodoState | undefined }) {
	const [collapsed, setCollapsed] = useState(false);
	if (!state || state.todos.length === 0) return null;

	const total = state.todos.length;
	const done = state.todos.filter((item) => item.status === "completed").length;
	const percent = total === 0 ? 0 : Math.round((done / total) * 100);
	const active = state.todos.find((item) => item.status === "in_progress");

	return (
		<div className="chat-todo-panel">
			<button type="button" className="chat-todo-header" onClick={() => setCollapsed((value) => !value)}>
				<span className="chat-todo-title">任务清单</span>
				<span className="chat-todo-progress">
					{done}/{total} · {percent}%
				</span>
				<span className="chat-todo-toggle">{collapsed ? "▸" : "▾"}</span>
			</button>
			{!collapsed && (
				<div className="chat-todo-body">
					{active?.activeForm && <div className="chat-todo-active">进行中：{active.activeForm}</div>}
					<ul className="chat-todo-list">
						{state.todos.map((item, index) => (
							<li key={`${index}-${item.content}`} className={`chat-todo-item status-${item.status}`}>
								<span className="chat-todo-num">{numberPrefix(state, index)}</span>
								<span className="chat-todo-content">
									{item.content}
									{item.activeForm && item.status === "in_progress" ? `（${item.activeForm}）` : ""}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
