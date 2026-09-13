/**
 * AutoPilotManager - Git-worktree isolated autonomous execution & self-healing engine.
 *
 * Drives real AI agent sessions in an isolated Git worktree, executes automated
 * tests, feeds error traces back into the same agent session for self-healing,
 * and prepares atomic Git pull-request diffs for 1-click delivery.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	advanceTaskStatus,
	type AutoPilotTask,
	createInitialAutoPilotTask,
	detectTestCommand,
	detectVerificationPipeline,
	type DiscoveredIssue,
	updateTaskStep,
	type VerificationPipeline,
} from "@openpi/shared";
import { ensureDaemon } from "./daemon.ts";

const execFileAsync = promisify(execFile);

export async function execGit(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	try {
		return await execFileAsync("git", args, {
			cwd,
			maxBuffer: 25 * 1024 * 1024,
			env: { ...process.env, LANG: "en_US.UTF-8" },
		});
	} catch (err: any) {
		const stdout = err.stdout?.toString?.() || "";
		const stderr = err.stderr?.toString?.() || err.message || "";
		throw new Error(stderr.trim() || stdout.trim() || "Git command failed");
	}
}

export async function runShellCommand(
	cwd: string,
	command: string,
	timeoutMs = 90000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	try {
		const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", command], {
			cwd,
			timeout: timeoutMs,
			maxBuffer: 25 * 1024 * 1024,
			env: { ...process.env, CI: "true" },
		});
		return { exitCode: 0, stdout: stdout.toString(), stderr: stderr.toString() };
	} catch (err: any) {
		return {
			exitCode: typeof err.code === "number" ? err.code : 1,
			stdout: err.stdout?.toString?.() || "",
			stderr: err.stderr?.toString?.() || err.message || "",
		};
	}
}

export async function runAgentSessionTurn(
	client: any,
	sessionId: string,
	prompt: string,
	onUpdate?: (info: { statusText: string; tool?: string; raw?: any }) => void,
	timeoutMs = 300000,
): Promise<{ success: boolean; error?: string }> {
	return new Promise((resolve) => {
		let timer: NodeJS.Timeout | undefined;
		let settled = false;

		const finish = (result: { success: boolean; error?: string }) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			try {
				removeListener();
			} catch {}
			resolve(result);
		};

		const handleEvent = (sid: string, event: any) => {
			if (sid !== sessionId) return;

			if (event.type === "tool_call" || event.type === "tool_start") {
				const toolName = event.tool || event.name || "tool";
				const argDesc =
					event.args?.path ||
					event.args?.target ||
					event.args?.command ||
					(event.args ? JSON.stringify(event.args).slice(0, 80) : "");
				onUpdate?.({
					statusText: `正在调用工具 [${toolName}] ${argDesc}`.trim(),
					tool: toolName,
					raw: event,
				});
			} else if (event.type === "tool_result" || event.type === "tool_end") {
				const toolName = event.tool || event.name || "tool";
				onUpdate?.({
					statusText: `工具 [${toolName}] 执行完毕`,
					tool: toolName,
					raw: event,
				});
			} else if (event.type === "message_update" && event.delta) {
				onUpdate?.({
					statusText: `Agent: ${event.delta.slice(0, 100).replace(/\n/g, " ")}`,
					raw: event,
				});
			} else if (
				event.type === "agent_settled" ||
				event.type === "agent_end" ||
				event.type === "turn_complete"
			) {
				finish({ success: true });
			} else if (event.type === "error") {
				finish({ success: false, error: event.message || "Agent turn encountered error" });
			}
		};

		const removeListener = client.onEvent(handleEvent);

		timer = setTimeout(() => {
			finish({ success: false, error: `Agent turn timed out after ${timeoutMs / 1000}s` });
		}, timeoutMs);

		// Subscribe to session and dispatch prompt
		client
			.request({ type: "subscribe", sessionId })
			.then(() => {
				return client.request({
					type: "rpc",
					sessionId,
					command: { type: "prompt", message: prompt },
				});
			})
			.catch((err: any) => {
				finish({ success: false, error: err.message || String(err) });
			});
	});
}

/**
 * Runs the multi-dimensional problem discovery radar across all configured dimensions
 * (Compile/Typecheck, Automated Tests, Lint, Build).
 */
export async function runDiscoveryRadar(
	worktreePath: string,
	pipeline: VerificationPipeline,
	appendLog: (logLine: string) => void,
): Promise<DiscoveredIssue[]> {
	const issues: DiscoveredIssue[] = [];

	// 1. Compile & Typecheck
	if (pipeline.typecheckCommand) {
		appendLog(`[雷达探测 1/4] 执行编译与类型检查: ${pipeline.typecheckCommand}`);
		const res = await runShellCommand(worktreePath, pipeline.typecheckCommand);
		if (res.exitCode !== 0) {
			const output = (res.stderr || res.stdout).trim();
			appendLog(`❌ 发现编译/类型报错 (Exit ${res.exitCode})`);
			issues.push({
				dimension: "typecheck",
				command: pipeline.typecheckCommand,
				exitCode: res.exitCode,
				output: output.slice(-3000),
				summary: `类型检查失败 (Exit ${res.exitCode})`,
			});
		} else {
			appendLog(`✅ 编译与类型检查通过 (0 错误)`);
		}
	}

	// 2. Automated Tests
	if (pipeline.testCommand) {
		appendLog(`[雷达探测 2/4] 执行自动化测试套件: ${pipeline.testCommand}`);
		const res = await runShellCommand(worktreePath, pipeline.testCommand);
		if (res.exitCode !== 0) {
			const output = (res.stderr || res.stdout).trim();
			appendLog(`❌ 发现测试失败项 (Exit ${res.exitCode})`);
			issues.push({
				dimension: "test",
				command: pipeline.testCommand,
				exitCode: res.exitCode,
				output: output.slice(-3000),
				summary: `自动化测试失败 (Exit ${res.exitCode})`,
			});
		} else {
			appendLog(`✅ 自动化测试全部通过 (0 失败)`);
		}
	}

	// 3. Lint / Code Quality
	if (pipeline.lintCommand) {
		appendLog(`[雷达探测 3/4] 执行代码规范与静态分析: ${pipeline.lintCommand}`);
		const res = await runShellCommand(worktreePath, pipeline.lintCommand);
		if (res.exitCode !== 0) {
			const output = (res.stderr || res.stdout).trim();
			appendLog(`⚠️ 发现代码规范问题 (Exit ${res.exitCode})`);
			issues.push({
				dimension: "lint",
				command: pipeline.lintCommand,
				exitCode: res.exitCode,
				output: output.slice(-2000),
				summary: `代码规范检查未通过 (Exit ${res.exitCode})`,
			});
		} else {
			appendLog(`✅ 代码规范检查通过`);
		}
	}

	// 4. Build sanity
	if (pipeline.buildCommand && pipeline.buildCommand !== pipeline.typecheckCommand) {
		appendLog(`[雷达探测 4/4] 执行打包与构建完整性验证: ${pipeline.buildCommand}`);
		const res = await runShellCommand(worktreePath, pipeline.buildCommand);
		if (res.exitCode !== 0) {
			const output = (res.stderr || res.stdout).trim();
			appendLog(`❌ 发现打包构建异常 (Exit ${res.exitCode})`);
			issues.push({
				dimension: "build",
				command: pipeline.buildCommand,
				exitCode: res.exitCode,
				output: output.slice(-3000),
				summary: `项目打包构建失败 (Exit ${res.exitCode})`,
			});
		} else {
			appendLog(`✅ 项目打包构建验证通过`);
		}
	}

	return issues;
}

/**
 * Generate a deterministic fingerprint of an issue set to detect stagnation and ping-pong loops.
 */
export function computeIssuesFingerprint(issues: DiscoveredIssue[]): string {
	return issues
		.map((iss) => `${iss.dimension}:${iss.command}:${iss.exitCode}:${iss.summary.slice(0, 50)}`)
		.sort()
		.join("|");
}

export interface OscillationCheckResult {
	isOscillating: boolean;
	isStagnant: boolean;
	message?: string;
}

/**
 * Check if the healing loop is stuck in identical errors (stagnation) or ping-ponging (oscillation).
 */
export function checkLoopOscillation(history: string[], currentFingerprint: string): OscillationCheckResult {
	if (history.length === 0) return { isOscillating: false, isStagnant: false };
	const last = history[history.length - 1];
	if (last === currentFingerprint) {
		return {
			isOscillating: false,
			isStagnant: true,
			message: "【停滞告警】当前轮次修复后错误集合完全未变，此前的代码修改未能命中问题根因。请更换排查切入点，重新审视调用方与类型定义。",
		};
	}
	if (history.length >= 2 && history[history.length - 2] === currentFingerprint) {
		return {
			isOscillating: true,
			isStagnant: false,
			message: "【循环振荡告警】检测到修复逻辑出现“修了 A 引发 B，修了 B 又打翻 A”的乒乓振荡。请综合审视跨模块依赖，切忌单向修补。",
		};
	}
	return { isOscillating: false, isStagnant: false };
}

export class AutoPilotManager {
	private tasks = new Map<string, AutoPilotTask>();
	private broadcaster?: (channel: string, payload: any) => void;

	constructor(broadcaster?: (channel: string, payload: any) => void) {
		this.broadcaster = broadcaster;
	}

	setBroadcaster(broadcaster: (channel: string, payload: any) => void) {
		this.broadcaster = broadcaster;
	}

	private notify(task: AutoPilotTask) {
		this.tasks.set(task.taskId, task);
		if (this.broadcaster) {
			try {
				this.broadcaster("autopilot-event", { task });
			} catch (err) {
				console.error("[AutoPilotManager] broadcast error:", err);
			}
		}
	}

	getTask(taskId: string): AutoPilotTask | undefined {
		return this.tasks.get(taskId);
	}

	listTasks(): AutoPilotTask[] {
		return Array.from(this.tasks.values());
	}

	async startTask(params: {
		cwd: string;
		prompt: string;
		testCommand?: string;
		typecheckCommand?: string;
		lintCommand?: string;
		buildCommand?: string;
		maxIterations?: number;
		autoExecuteCode?: (options: {
			worktreePath: string;
			prompt: string;
		}) => Promise<boolean>;
		autoExecuteHeal?: (options: {
			worktreePath: string;
			prompt: string;
			errorLog: string;
			iteration: number;
		}) => Promise<boolean>;
	}): Promise<AutoPilotTask> {
		const { cwd, prompt } = params;

		// 1. Verify that cwd is a valid git repository
		await execGit(cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => {
			throw new Error(`当前目录不是有效的 Git 仓库: ${cwd}`);
		});

		// 2. Identify current branch as base
		const branchRes = await execGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ({
			stdout: "main",
			stderr: "",
		}));
		const baseBranch = branchRes.stdout.trim() || "main";

		// 3. Generate Task ID & paths
		const taskId = `pilot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const branch = `openpi/pilot-${taskId.slice(6)}`;
		const worktreeDir = join(cwd, ".openpi", "worktrees");
		if (!existsSync(worktreeDir)) {
			mkdirSync(worktreeDir, { recursive: true });
		}
		const worktreePath = join(worktreeDir, taskId);

		// 4. Multi-dimensional verification pipeline detection
		let packageJson: any = null;
		const pkgPath = join(cwd, "package.json");
		if (existsSync(pkgPath)) {
			try {
				packageJson = JSON.parse(readFileSync(pkgPath, "utf8"));
			} catch {}
		}
		const verificationPipeline = detectVerificationPipeline({ packageJson });
		if (params.testCommand?.trim()) {
			verificationPipeline.testCommand = params.testCommand.trim();
		}
		if (params.typecheckCommand?.trim()) {
			verificationPipeline.typecheckCommand = params.typecheckCommand.trim();
		}
		if (params.lintCommand?.trim()) {
			verificationPipeline.lintCommand = params.lintCommand.trim();
		}
		if (params.buildCommand?.trim()) {
			verificationPipeline.buildCommand = params.buildCommand.trim();
		}

		let task = createInitialAutoPilotTask({
			taskId,
			cwd,
			prompt,
			branch,
			worktreePath,
			baseBranch,
			testCommand: verificationPipeline.testCommand,
			maxIterations: params.maxIterations ?? 5,
		});
		task.verificationPipeline = verificationPipeline;
		task.discoveredIssues = [];
		task.logs = [];

		this.notify(task);

		// Run pipeline asynchronously in background
		void this.runPipeline(task, verificationPipeline, params.autoExecuteHeal, params.autoExecuteCode);

		return task;
	}

	private async runPipeline(
		initialTask: AutoPilotTask,
		verificationPipeline: VerificationPipeline,
		autoExecuteHeal?: (options: {
			worktreePath: string;
			prompt: string;
			errorLog: string;
			iteration: number;
		}) => Promise<boolean>,
		autoExecuteCode?: (options: {
			worktreePath: string;
			prompt: string;
		}) => Promise<boolean>,
	) {
		let task = initialTask;
		const { cwd, worktreePath, branch, baseBranch, prompt } = task;

		const appendLog = (logLine: string) => {
			const time = new Date().toLocaleTimeString();
			const entry = `[${time}] ${logLine}`;
			const existing = task.logs || [];
			task = { ...task, logs: [...existing.slice(-80), entry] };
			this.notify(task);
		};

		try {
			// ── STEP 1: Create Git Worktree ────────────────────────────
			task = updateTaskStep(task, "step-worktree", {
				status: "running",
				detail: `正在检出分支 ${branch} 到隔离目录...`,
			});
			appendLog(`创建独立隔离分支 ${branch}`);
			this.notify(task);

			await execGit(cwd, ["worktree", "add", "-b", branch, worktreePath, baseBranch]);

			task = updateTaskStep(task, "step-worktree", {
				status: "passed",
				detail: `已成功创建工作区隔离分支: ${branch}`,
			});
			task = advanceTaskStatus(task, "executing");
			appendLog(`Git Worktree 隔离就绪: ${worktreePath}`);
			this.notify(task);

			// ── STEP 2: Autonomous Agent Plan & Code ────────────────────
			task = updateTaskStep(task, "step-plan-code", {
				status: "running",
				detail: `正在启动真实 Agent 会话分析需求并实施代码变更...`,
			});
			appendLog(`正在初始化 Coding Agent 会话...`);
			this.notify(task);

			let daemonClient: any = undefined;
			if (!process.env.VITEST && !autoExecuteCode && !autoExecuteHeal) {
				try {
					daemonClient = await ensureDaemon();
				} catch (e: any) {
					console.warn("[AutoPilotManager] Daemon not available, running in fallback mode:", e.message);
				}
			}

			let sessionId: string | undefined = undefined;
			if (autoExecuteCode) {
				appendLog(`[测试驱动] 运行注入的自定义代码实施器...`);
				await autoExecuteCode({ worktreePath, prompt });
			} else if (daemonClient) {
				try {
					const sessionRes = (await daemonClient.request({
						type: "create_session",
						cwd: worktreePath,
						mode: "code",
						name: `AutoPilot: ${prompt.slice(0, 30)}`,
					})) as any;
					sessionId = sessionRes?.sessionId;
					if (sessionId) {
						task = { ...task, sessionId };
						appendLog(`Agent 会话已建立 (Session: ${sessionId.slice(0, 8)})`);
						this.notify(task);

						const agentPrompt =
							`你当前正在独立 Git Worktree 隔离目录中执行无人值守任务。\n` +
							`工作区路径: ${worktreePath}\n` +
							`分支: ${branch}\n\n` +
							`【无人值守核心宗旨】\n` +
							`所谓的“无人值守”，就是不断去主动发现工程中的问题，一直修复解决好为止，直到整个工程全维度 0 报错完全收敛！\n\n` +
							`【用户研发需求】\n${prompt}\n\n` +
							`【执行指令】\n` +
							`1. 请使用代码探索工具（read, find, grep 等）深入了解现有工程架构；\n` +
							`2. 使用编辑工具（edit, write 等）实施健壮、完备的代码变更，并编写或更新测试用例自证逻辑；\n` +
							`3. 主动自查：主动发现代码中的潜在语法不完备、类型错误或边界缺陷；\n` +
							`4. 完成后简要说明已完成的变更文件和实现要点。系统将启动全维雷达进行验证。`;

						const turnResult = await runAgentSessionTurn(
							daemonClient,
							sessionId,
							agentPrompt,
							({ statusText }) => {
								task = updateTaskStep(task, "step-plan-code", {
									status: "running",
									detail: statusText,
								});
								appendLog(statusText);
								this.notify(task);
							},
						);

						if (!turnResult.success) {
							appendLog(`Agent 提示: ${turnResult.error || "Turn ended"}`);
						}
					}
				} catch (err: any) {
					appendLog(`启动 Agent 会话异常: ${err.message || String(err)}`);
				}
			} else {
				// Fallback for standalone/mock tests
				appendLog(`离线模式：跳过远程 Daemon Agent`);
			}

			task = updateTaskStep(task, "step-plan-code", {
				status: "passed",
				detail: `代码变更已由 Agent 实施就绪`,
			});
			appendLog(`Agent 编码实施阶段完成`);
			this.notify(task);

			// ── STEP 3: Multi-Dimensional Issue Discovery Radar ─────────
			task = updateTaskStep(task, "step-test", {
				status: "running",
				detail: `正在启动全维问题主动发现雷达 (编译/类型/测试/规范/构建)...`,
			});
			task = advanceTaskStatus(task, "testing");
			appendLog(`【全维问题雷达】开始全面扫描工程潜在问题...`);
			this.notify(task);

			let issues = await runDiscoveryRadar(worktreePath, verificationPipeline, appendLog);
			task = { ...task, discoveredIssues: issues };

			if (issues.length === 0) {
				task = updateTaskStep(task, "step-test", {
					status: "passed",
					detail: `全维雷达扫描通过：未发现任何编译、类型、测试或构建问题 (0 报错)`,
				});
				task = updateTaskStep(task, "step-heal", {
					status: "skipped",
					detail: `初次扫描全维度 0 问题，工程已完全收敛，无需自愈`,
				});
				appendLog(`🎉 全维雷达扫描完毕：未发现任何问题，工程完全收敛！`);
				this.notify(task);
			} else {
				// Issues discovered! Trigger Continuous Self-Healing Loop
				task = updateTaskStep(task, "step-test", {
					status: "failed",
					detail: `全维雷达发现 ${issues.length} 项未解决问题 (${issues.map((i) => i.summary).join(", ")})，准备进入持续自愈循环...`,
					error: issues.map((iss) => `[${iss.dimension.toUpperCase()}] ${iss.summary}:\n${iss.output}`).join("\n\n"),
				});
				task = advanceTaskStatus(task, "diagnosing");
				appendLog(`⚠️ 全维雷达发现 ${issues.length} 项问题，进入持续自愈收敛循环...`);
				this.notify(task);

				// ── STEP 4: Continuous Discovery & Self-Healing Loop ───────
				let healed = false;
				let currentIssues = issues;
				const maxIter = task.maxIterations || 5;
				const fingerprintHistory: string[] = [];

				for (let i = 1; i <= maxIter; i++) {
					const currentFp = computeIssuesFingerprint(currentIssues);
					const oscillation = checkLoopOscillation(fingerprintHistory, currentFp);
					fingerprintHistory.push(currentFp);

					if (oscillation.message) {
						appendLog(oscillation.message);
					}

					if (
						oscillation.isOscillating &&
						fingerprintHistory.filter((f) => f === currentFp).length >= 3
					) {
						appendLog(`⚠️ 检测到循环振荡死锁 (多次在相同错误集合间乒乓跳动)，提前停止盲目尝试并保留当前现场`);
						break;
					}

					task = { ...task, currentIteration: i };
					task = updateTaskStep(task, "step-heal", {
						status: "running",
						detail: `[持续自愈第 ${i}/${maxIter} 轮] 正在深度归因并解决剩余 ${currentIssues.length} 项问题...`,
					});
					appendLog(`[第 ${i}/${maxIter} 轮自愈] 针对发现的 ${currentIssues.length} 个问题进行代码重构修复...`);
					this.notify(task);

					if (daemonClient && sessionId) {
						const steerNote = oscillation.message ? `\n\n【注意】：${oscillation.message}\n` : "";
						const healPrompt =
							`【无人值守自愈闭环 - 第 ${i}/${maxIter} 轮】${steerNote}\n` +
							`所谓的无人值守，就是不断去发现工程中的问题，一直到彻底解决好为止！\n\n` +
							`当前全维雷达探测到了以下 ${currentIssues.length} 项未通过问题：\n` +
							currentIssues
								.map(
									(iss, idx) =>
										`=== 问题 ${idx + 1} [${iss.dimension.toUpperCase()}] ===\n` +
										`探测命令: ${iss.command}\n` +
										`退出状态码: ${iss.exitCode}\n` +
										`报错堆栈与诊断信息:\n\`\`\`\n${iss.output}\n\`\`\``,
								)
								.join("\n\n") +
							`\n\n【修复指令】\n` +
							`1. 仔细阅读每一处报错堆栈，定位具体出错的文件与代码行；\n` +
							`2. 针对问题根因直接修改代码（使用 edit / write 工具）；\n` +
							`3. 保证修复方案彻底、健壮，避免引入次生问题；\n` +
							`4. 修复完成后说明你修复了哪些问题。系统将再次全量扫描，直到 0 报错完全解决好为止。`;

						await runAgentSessionTurn(
							daemonClient,
							sessionId,
							healPrompt,
							({ statusText }) => {
								task = updateTaskStep(task, "step-heal", {
									status: "running",
									detail: `[第 ${i} 轮自愈] ${statusText}`,
								});
								appendLog(`[自愈] ${statusText}`);
								this.notify(task);
							},
						);
					} else if (autoExecuteHeal) {
						const primaryError = currentIssues[0]?.output || "";
						await autoExecuteHeal({
							worktreePath,
							prompt: task.prompt,
							errorLog: primaryError,
							iteration: i,
						});
					}

					// Re-run discovery radar across ALL dimensions!
					appendLog(`[第 ${i} 轮复查] 重新启动全维问题雷达扫描...`);
					currentIssues = await runDiscoveryRadar(worktreePath, verificationPipeline, appendLog);
					task = { ...task, discoveredIssues: currentIssues };

					if (currentIssues.length === 0) {
						healed = true;
						task = updateTaskStep(task, "step-heal", {
							status: "passed",
							detail: `持续自愈成功！经过 ${i} 轮排查与修复，工程已完全解决好所有问题 (0 报错全部收敛)！`,
						});
						appendLog(`🎉 持续自愈成功！全维度 0 问题，工程已完全解决好！`);
						break;
					} else {
						appendLog(`[第 ${i} 轮复查] 仍有 ${currentIssues.length} 项问题未收敛，继续自愈...`);
					}
				}

				if (!healed) {
					task = updateTaskStep(task, "step-heal", {
						status: "failed",
						detail: `已完成 ${maxIter} 轮自愈，仍有 ${currentIssues.length} 项问题未完全收敛。改动已完整保留，可点击「继续深入自愈」或审查 Diff`,
					});
					appendLog(`已达到当前轮次上限 (${maxIter} 轮)，保留上下文供进一步自愈或人工合并`);
				}
			}

			// ── STEP 5: Finalize Delivery ────────────────────────────────
			await this.finalizeDelivery(task, appendLog);
		} catch (err: any) {
			appendLog(`任务异常中断: ${err.message || String(err)}`);
			task = advanceTaskStatus(task, "failed", err.message || String(err));
			this.notify(task);
		}
	}

	private async finalizeDelivery(task: AutoPilotTask, appendLog: (line: string) => void) {
		const { worktreePath, baseBranch } = task;

		task = updateTaskStep(task, "step-delivery", {
			status: "running",
			detail: `正在生成提交差异报告与交付变更审查...`,
		});
		appendLog(`正在生成原子提交与变更审查报告...`);
		this.notify(task);

		// Stage changes if any untracked or modified
		try {
			await execGit(worktreePath, ["add", "-A"]);
			const statusPorcelain = await execGit(worktreePath, ["status", "--porcelain=v1"]);
			if (statusPorcelain.stdout.trim()) {
				await execGit(worktreePath, ["commit", "-m", `feat(autopilot): ${task.prompt}`]);
			}
		} catch {}

		// Diff against baseBranch
		let diff = "";
		try {
			const diffRes = await execGit(worktreePath, ["diff", `${baseBranch}...HEAD`]);
			diff = diffRes.stdout;
		} catch {
			const fallbackDiff = await execGit(worktreePath, ["diff", "HEAD~1"]).catch(() => ({
				stdout: "",
			}));
			diff = fallbackDiff.stdout;
		}

		// Changed files list
		let changedFiles: string[] = [];
		try {
			const nameOnly = await execGit(worktreePath, ["diff", "--name-only", `${baseBranch}...HEAD`]);
			changedFiles = nameOnly.stdout
				.split("\n")
				.map((f) => f.trim())
				.filter(Boolean);
		} catch {}

		task = {
			...task,
			diff,
			changedFiles,
		};

		task = updateTaskStep(task, "step-delivery", {
			status: "passed",
			detail: `代码已准备好审核。包含 ${changedFiles.length} 个文件变更。`,
		});
		task = advanceTaskStatus(task, "ready_for_review");
		appendLog(`交付就绪：共 ${changedFiles.length} 个文件变更，等待一键合并`);
		this.notify(task);
	}

	/**
	 * Continues the healing loop with additional iterations until all issues are resolved.
	 */
	async continueHealing(taskId: string, additionalIterations = 3): Promise<AutoPilotTask> {
		const task = this.tasks.get(taskId);
		if (!task) {
			throw new Error(`找不到任务 ${taskId}`);
		}
		if (task.status === "merged" || task.status === "discarded") {
			throw new Error(`已${task.status === "merged" ? "合并" : "丢弃"}的任务无法继续自愈`);
		}
		if (!existsSync(task.worktreePath)) {
			throw new Error(`隔离工作区已不存在: ${task.worktreePath}`);
		}

		const newMax = (task.maxIterations || 5) + additionalIterations;
		const updatedTask: AutoPilotTask = {
			...task,
			maxIterations: newMax,
			status: "diagnosing",
		};
		this.notify(updatedTask);

		void this.runHealingContinuation(updatedTask);

		return updatedTask;
	}

	private async runHealingContinuation(initialTask: AutoPilotTask) {
		let task = initialTask;
		const { worktreePath, verificationPipeline } = task;
		const appendLog = (logLine: string) => {
			const time = new Date().toLocaleTimeString();
			const entry = `[${time}] ${logLine}`;
			const existing = task.logs || [];
			task = { ...task, logs: [...existing.slice(-80), entry] };
			this.notify(task);
		};

		let daemonClient: any = undefined;
		if (!process.env.VITEST) {
			try {
				daemonClient = await ensureDaemon();
			} catch {}
		}

		const pipeline = verificationPipeline || { testCommand: task.testCommand };
		appendLog(`[继续自愈] 重新启动全维问题雷达扫描...`);
		let currentIssues = await runDiscoveryRadar(worktreePath, pipeline, appendLog);
		task = { ...task, discoveredIssues: currentIssues };

		let healed = currentIssues.length === 0;
		if (healed) {
			task = updateTaskStep(task, "step-heal", {
				status: "passed",
				detail: `全维雷达复检全部通过！工程已完全收敛为 0 问题！`,
			});
			appendLog(`🎉 持续自愈成功！全维度 0 问题，工程已完全解决好！`);
		}

		const startIter = (task.currentIteration || 1) + 1;
		const maxIter = task.maxIterations;
		const fingerprintHistory: string[] = [];

		for (let i = startIter; i <= maxIter; i++) {
			if (healed) break;

			const currentFp = computeIssuesFingerprint(currentIssues);
			const oscillation = checkLoopOscillation(fingerprintHistory, currentFp);
			fingerprintHistory.push(currentFp);

			if (oscillation.message) {
				appendLog(oscillation.message);
			}

			if (
				oscillation.isOscillating &&
				fingerprintHistory.filter((f) => f === currentFp).length >= 3
			) {
				appendLog(`⚠️ 检测到循环振荡死锁 (多次在相同错误集合间乒乓跳动)，提前停止盲目尝试并保留当前现场`);
				break;
			}

			task = { ...task, currentIteration: i };
			task = updateTaskStep(task, "step-heal", {
				status: "running",
				detail: `[深入自愈第 ${i}/${maxIter} 轮] 正在排查剩余 ${currentIssues.length} 项问题...`,
			});
			appendLog(`[深入自愈第 ${i}/${maxIter} 轮] 针对剩余 ${currentIssues.length} 个问题进行代码重构...`);
			this.notify(task);

			if (daemonClient && task.sessionId) {
				const steerNote = oscillation.message ? `\n\n【注意】：${oscillation.message}\n` : "";
				const healPrompt =
					`【无人值守自愈闭环 - 深入自愈第 ${i}/${maxIter} 轮】${steerNote}\n` +
					`所谓的无人值守，就是不断去发现工程中的问题，一直到彻底解决好为止！\n\n` +
					`当前全维雷达探测到了以下 ${currentIssues.length} 项未通过问题：\n` +
					currentIssues
						.map(
							(iss, idx) =>
								`=== 问题 ${idx + 1} [${iss.dimension.toUpperCase()}] ===\n` +
								`探测命令: ${iss.command}\n` +
								`退出状态码: ${iss.exitCode}\n` +
								`报错堆栈与诊断信息:\n\`\`\`\n${iss.output}\n\`\`\``,
						)
						.join("\n\n") +
					`\n\n【修复指令】\n` +
					`1. 仔细阅读每一处报错堆栈，定位具体出错的文件与代码行；\n` +
					`2. 针对问题根因直接修改代码（使用 edit / write 工具）；\n` +
					`3. 保证修复方案彻底、健壮，避免引入次生问题；\n` +
					`4. 修复完成后说明你修复了哪些问题。系统将再次全量扫描，直到 0 报错完全解决好为止。`;

				await runAgentSessionTurn(daemonClient, task.sessionId, healPrompt, ({ statusText }) => {
					task = updateTaskStep(task, "step-heal", {
						status: "running",
						detail: `[第 ${i} 轮自愈] ${statusText}`,
					});
					appendLog(`[自愈] ${statusText}`);
					this.notify(task);
				});
			}

			// Re-scan
			appendLog(`[第 ${i} 轮复查] 重新启动全维问题雷达扫描...`);
			currentIssues = await runDiscoveryRadar(worktreePath, pipeline, appendLog);
			task = { ...task, discoveredIssues: currentIssues };

			if (currentIssues.length === 0) {
				healed = true;
				task = updateTaskStep(task, "step-heal", {
					status: "passed",
					detail: `持续自愈成功！经过 ${i} 轮排查与修复，工程已完全解决好所有问题 (0 报错全部收敛)！`,
				});
				appendLog(`🎉 持续自愈成功！全维度 0 问题，工程已完全解决好！`);
				break;
			} else {
				appendLog(`[第 ${i} 轮复查] 仍有 ${currentIssues.length} 项问题未收敛，继续自愈...`);
			}
		}

		if (healed || currentIssues.length === 0) {
			await this.finalizeDelivery(task, appendLog);
		} else {
			task = updateTaskStep(task, "step-heal", {
				status: "failed",
				detail: `已完成 ${maxIter} 轮自愈，仍有 ${currentIssues.length} 项问题未完全收敛。改动已完整保留，可点击「继续深入自愈」或审查 Diff`,
			});
			this.notify(task);
		}
	}

	async mergeTask(taskId: string): Promise<{ success: boolean; error?: string }> {
		const task = this.tasks.get(taskId);
		if (!task) {
			return { success: false, error: `找不到任务 ${taskId}` };
		}

		try {
			// Merge branch into main repo
			await execGit(task.cwd, [
				"merge",
				"--no-ff",
				task.branch,
				"-m",
				`feat(autopilot): ${task.prompt} (#${taskId})`,
			]);

			// Remove worktree
			await execGit(task.cwd, ["worktree", "remove", "--force", task.worktreePath]).catch(() => {});
			if (existsSync(task.worktreePath)) {
				rmSync(task.worktreePath, { recursive: true, force: true });
			}

			// Delete merged branch
			await execGit(task.cwd, ["branch", "-d", task.branch]).catch(() => {
				return execGit(task.cwd, ["branch", "-D", task.branch]).catch(() => {});
			});

			const updated = advanceTaskStatus(task, "merged");
			this.notify(updated);
			return { success: true };
		} catch (err: any) {
			return { success: false, error: err.message || String(err) };
		}
	}

	async discardTask(taskId: string): Promise<{ success: boolean; error?: string }> {
		const task = this.tasks.get(taskId);
		if (!task) {
			return { success: false, error: `找不到任务 ${taskId}` };
		}

		try {
			// Remove worktree
			await execGit(task.cwd, ["worktree", "remove", "--force", task.worktreePath]).catch(() => {});
			if (existsSync(task.worktreePath)) {
				rmSync(task.worktreePath, { recursive: true, force: true });
			}

			// Force delete branch
			await execGit(task.cwd, ["branch", "-D", task.branch]).catch(() => {});

			const updated = advanceTaskStatus(task, "discarded");
			this.notify(updated);
			return { success: true };
		} catch (err: any) {
			return { success: false, error: err.message || String(err) };
		}
	}
}

export const autopilotManager = new AutoPilotManager();
