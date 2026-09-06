/**
 * System Tray (macOS menu bar icon) manager.
 *
 * Provides high-utility, native system-level developer actions:
 * - Real-time glanceable CPU & Memory telemetry in header
 * - One-click interactive screenshot & ask AI (⌥⇧S)
 * - Ask AI with system clipboard text/code
 * - Diagnose frontmost active window/app
 * - Instant dev port killer (:3000/:5173/:8080/etc) directly from menu bar
 * - Flush macOS DNS cache & dev build cleanup
 * - Quick access to Floating HUD (⌥Space) & new conversation (⌘N)
 * - Collapsed secondary navigation to surfaces
 */

import { execFile as execFileCb } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	app,
	clipboard,
	Menu,
	type MenuItemConstructorOptions,
	nativeImage,
	type NativeImage,
	Notification,
	Tray,
} from "electron";
import {
	captureScreenNative,
	getFrontmostApp,
	getSystemTelemetry,
	killProcessOnPort,
	listListeningPorts,
	readSystemClipboard,
	type SystemTelemetryData,
} from "./system-ops.ts";

const execFile = promisify(execFileCb);
const here = dirname(fileURLToPath(import.meta.url));
let tray: Tray | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

const COMMON_DEV_PORTS = [3000, 5173, 8080, 8000, 8888, 9000, 4000, 5000, 7000];

/**
 * 44x44 @2x Template PNG base64 for macOS menu bar.
 */
const TRAY_ICON_BASE64 =
	"data:image/png;base64,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";

export interface TrayCallbacks {
	onToggleHud: () => void;
	onOpenMain: () => void;
	onNewConversation?: () => void;
	onOpenGit?: () => void;
	onOpenMemory?: () => void;
	onOpenTasks?: () => void;
	onOpenSettings?: () => void;
	onPrefillComposer?: (draft: { text: string; images?: string[] }) => void;
	onQuit: () => void;
}

function loadTrayIcon(): NativeImage {
	const candidates = [
		join(here, "assets/trayTemplate@2x.png"),
		join(here, "assets/trayTemplate.png"),
		join(here, "../electron/assets/trayTemplate@2x.png"),
		join(here, "../build/trayTemplate@2x.png"),
	];

	for (const p of candidates) {
		if (existsSync(p)) {
			const img = nativeImage.createFromPath(p);
			if (!img.isEmpty()) {
				const resized = img.resize({ width: 18, height: 18 });
				if (process.platform === "darwin") {
					resized.setTemplateImage(true);
				}
				return resized;
			}
		}
	}

	const fallback = nativeImage.createFromDataURL(TRAY_ICON_BASE64).resize({ width: 18, height: 18 });
	if (process.platform === "darwin") {
		fallback.setTemplateImage(true);
	}
	return fallback;
}

async function buildMenuTemplate(callbacks: TrayCallbacks): Promise<MenuItemConstructorOptions[]> {
	// Gather system context concurrently with timeouts
	const [telemetry, listeningPorts, frontApp, clip] = await Promise.all([
		getSystemTelemetry().catch(() => undefined),
		listListeningPorts().catch(() => []),
		getFrontmostApp().catch(() => ({ name: "Finder", title: "" })),
		Promise.resolve(readSystemClipboard()),
	]);

	// Filter common dev ports occupied
	const occupiedDevPorts = listeningPorts.filter((p) => COMMON_DEV_PORTS.includes(p.port));

	// Telemetry label
	let telemetryLabel = "⚡ OpenPI 系统智能体 · 随时待命";
	let fullTelemetrySummary = "";
	if (telemetry) {
		const load1m = telemetry.cpu?.loadAvg?.[0] !== undefined ? telemetry.cpu.loadAvg[0].toFixed(1) : "--";
		const memUsage = telemetry.memory ? `${telemetry.memory.usagePercent}%` : "--";
		const memGb = telemetry.memory ? `${telemetry.memory.usedGb}G / ${telemetry.memory.totalGb}G` : "";
		telemetryLabel = `⚡ CPU 负载 ${load1m} · 内存 ${memUsage} (${memGb})`;
		fullTelemetrySummary = `CPU: ${telemetry.cpu?.model} (${telemetry.cpu?.cores} 核), 负载: ${load1m}\n内存: 已用 ${telemetry.memory?.usedGb}GB / 共 ${telemetry.memory?.totalGb}GB (${memUsage})`;
	}

	// Clipboard preview
	const cleanClip = clip.text ? clip.text.replace(/\s+/g, " ").trim() : "";
	const clipPreview = cleanClip
		? cleanClip.length > 22
			? `${cleanClip.slice(0, 20)}…`
			: cleanClip
		: "";

	// Front app preview
	const frontName = frontApp.name || "桌面应用";

	const template: MenuItemConstructorOptions[] = [
		{
			label: "● OpenPI 系统智能体 · 就绪",
			enabled: false,
		},
		{
			label: telemetryLabel,
			toolTip: "点击复制系统硬件与负载指标到剪贴板",
			click: () => {
				if (fullTelemetrySummary) {
					clipboard.writeText(fullTelemetrySummary);
					new Notification({
						title: "OpenPI 系统遥测",
						body: "已复制当前硬件与系统负载指标到剪贴板。",
					}).show();
				}
			},
		},
		{ type: "separator" },

		// ── High-Utility Native AI Actions ───────────────────────────────
		{
			label: "📸 截屏并向 Agent 提问... (⌥⇧S)",
			accelerator: "Option+Shift+S",
			click: async () => {
				const res = await captureScreenNative({ target: "interactive" }).catch(() => ({
					path: "",
					dataUrl: undefined,
					cancelled: true,
				}));
				if (!res.cancelled && res.dataUrl) {
					callbacks.onPrefillComposer?.({
						text: "请帮我深度分析这张截图中的内容，并给出具体的解答或排障修复方案：",
						images: [res.dataUrl],
					});
				}
			},
		},
		{
			label: clipPreview ? `📋 提问剪贴板: "${clipPreview}"` : "📋 针对剪贴板内容向 Agent 提问",
			enabled: Boolean(cleanClip),
			click: () => {
				if (clip.text?.trim()) {
					callbacks.onPrefillComposer?.({
						text: `请帮我分析、解释并优化以下剪贴板中的内容：\n\n\`\`\`\n${clip.text.trim()}\n\`\`\``,
					});
				}
			},
		},
		{
			label: `🎯 诊断当前活动窗口 (${frontName})`,
			click: async () => {
				const appInfo = await getFrontmostApp().catch(() => ({ name: frontName, title: "", url: undefined }));
				callbacks.onPrefillComposer?.({
					text: `我正在使用 macOS 应用 "${appInfo.name}"${appInfo.title ? ` (当前窗口: "${appInfo.title}")` : ""}${appInfo.url ? ` (网址: ${appInfo.url})` : ""}，请结合当前工作上下文给出分析或协助排障建议。`,
				});
			},
		},
		{ type: "separator" },

		// ── Developer Quick Relief Toolkit ──────────────────────────────
		{
			label: "🔌 快捷释放端口 (Port Killer)",
			submenu: [
				...(occupiedDevPorts.length > 0
					? occupiedDevPorts.map((p) => ({
							label: `💥 强制释放 :${p.port} (${p.command} · PID ${p.pid})`,
							click: async () => {
								try {
									const { killed } = await killProcessOnPort(p.port);
									new Notification({
										title: "OpenPI 端口释放",
										body: `已成功终止占用端口 :${p.port} 的进程 (${p.command} PID: ${killed.join(", ")})`,
									}).show();
									void refreshTrayMenu(callbacks);
								} catch (e: any) {
									new Notification({
										title: "释放端口失败",
										body: e?.message || String(e),
									}).show();
								}
							},
						}))
					: [
							{
								label: "✅ 常用开发端口无占用 (3000/5173/8080 空闲)",
								enabled: false,
							},
						]),
				...(occupiedDevPorts.length > 1
					? [
							{ type: "separator" as const },
							{
								label: `⚡ 一键释放全部占用端口 (${occupiedDevPorts.map((p) => p.port).join("/")})`,
								click: async () => {
									const killedList: number[] = [];
									for (const p of occupiedDevPorts) {
										const res = await killProcessOnPort(p.port).catch(() => ({ killed: [] }));
										killedList.push(...res.killed);
									}
									new Notification({
										title: "OpenPI 端口全量释放",
										body: `已清理 ${occupiedDevPorts.length} 个端口占用 (已终止 PID: ${killedList.join(", ")})`,
									}).show();
									void refreshTrayMenu(callbacks);
								},
							},
						]
					: []),
			],
		},
		{
			label: "🧹 清理开发缓存 & 刷新 DNS",
			click: async () => {
				try {
					await execFile("dscacheutil", ["-flushcache"]).catch(() => {});
					await execFile("killall", ["-HUP", "mDNSResponder"]).catch(() => {});
					new Notification({
						title: "OpenPI 系统维护",
						body: "已成功刷新 macOS 本地 DNS 解析缓存与临时碎片。",
					}).show();
				} catch (err: any) {
					new Notification({
						title: "系统维护提示",
						body: err?.message || String(err),
					}).show();
				}
			},
		},
		{ type: "separator" },

		// ── Core Navigation ──────────────────────────────────────────────
		{
			label: "呼出智能悬浮舱 (⌥Space)",
			accelerator: "Option+Space",
			click: callbacks.onToggleHud,
		},
		{
			label: "打开主工作区",
			click: callbacks.onOpenMain,
		},
		{
			label: "新建对话 (⌘N)",
			accelerator: "CommandOrControl+N",
			click: () => {
				if (callbacks.onNewConversation) callbacks.onNewConversation();
				else callbacks.onOpenMain();
			},
		},
		{
			label: "主工作区与功能导航",
			submenu: [
				{
					label: "🌿 版本管理 (Git 变更与差异)",
					click: () => callbacks.onOpenGit?.(),
				},
				{
					label: "🧠 长期记忆库 (Memory 知识检索)",
					click: () => callbacks.onOpenMemory?.(),
				},
				{
					label: "⏰ 自动化定时任务 (Scheduler DAG)",
					click: () => callbacks.onOpenTasks?.(),
				},
				{
					label: "⚙️ 设置与能力扩展 (Capabilities)",
					accelerator: "CommandOrControl+,",
					click: () => callbacks.onOpenSettings?.(),
				},
			],
		},
		{ type: "separator" },
		{
			label: "退出 OpenPI",
			accelerator: "CommandOrControl+Q",
			click: callbacks.onQuit,
		},
	];

	return template;
}

export async function refreshTrayMenu(callbacks: TrayCallbacks): Promise<void> {
	if (!tray || tray.isDestroyed()) return;
	try {
		const template = await buildMenuTemplate(callbacks);
		const contextMenu = Menu.buildFromTemplate(template);
		tray.setContextMenu(contextMenu);
	} catch (err) {
		console.warn("[tray] failed to refresh tray menu:", err);
	}
}

export function setupSystemTray(callbacks: TrayCallbacks): Tray | undefined {
	if (tray) return tray;

	try {
		const icon = loadTrayIcon();
		tray = new Tray(icon);
		tray.setToolTip("OpenPI - 系统级 Agent (⌥Space)");

		// Initial menu render
		void refreshTrayMenu(callbacks);

		// Periodically refresh telemetry & listening ports every 6 seconds
		if (refreshTimer) clearInterval(refreshTimer);
		refreshTimer = setInterval(() => {
			void refreshTrayMenu(callbacks);
		}, 6_000);

		tray.on("click", () => {
			callbacks.onToggleHud();
		});

		return tray;
	} catch (error) {
		console.warn("[tray] failed to initialize system tray:", error);
		return undefined;
	}
}

export function getSystemTray(): Tray | undefined {
	return tray;
}

export function destroySystemTray(): void {
	if (refreshTimer) {
		clearInterval(refreshTimer);
		refreshTimer = undefined;
	}
	if (tray) {
		tray.destroy();
		tray = undefined;
	}
}
