/**
 * Runtime Hot-Update Manager for OpenPI Desktop.
 *
 * Allows OpenPI kernel runtime (daemon.js, extensions, pinned pi-coding-agent)
 * to be independently upgraded, rolled back, or locally installed without
 * reinstalling the entire ~100MB+ Electron application.
 */

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, renameSync, statSync, createWriteStream } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import https from "node:https";
import http from "node:http";
import { app } from "electron";
import {
	daemonCli,
	getBuiltInRuntimeDir,
	getUserRuntimeDir,
	restartDaemon,
	ensureDaemon,
} from "./daemon.ts";

const execFileAsync = promisify(execFile);

export interface RuntimeManifest {
	name?: string;
	version?: string;
	piVersion?: string;
	buildTime?: string;
	gitCommit?: string;
	schemaVersion?: number;
}

export interface RuntimeInfo {
	currentVersion: string;
	piVersion?: string;
	buildTime?: string;
	gitCommit?: string;
	isHotUpdated: boolean;
	runtimePath: string;
	builtInVersion?: string;
	builtInPath: string;
}

export interface RuntimeUpdateCheckResult {
	hasUpdate: boolean;
	currentVersion: string;
	latestVersion?: string;
	releaseNotes?: string;
	publishedAt?: string;
	assetName?: string;
	assetUrl?: string;
	assetSize?: number;
}

export interface RuntimeUpdateProgress {
	stage: "downloading" | "extracting" | "verifying" | "restarting" | "completed" | "error";
	percent: number;
	message?: string;
}

function readManifest(dirPath: string): RuntimeManifest | null {
	const manifestPath = join(dirPath, "runtime-manifest.json");
	if (!existsSync(manifestPath)) return null;
	try {
		return JSON.parse(readFileSync(manifestPath, "utf8")) as RuntimeManifest;
	} catch {
		return null;
	}
}

/** Cross-platform zip extraction with robust fallbacks. */
export async function extractZip(zipPath: string, targetDir: string): Promise<void> {
	mkdirSync(targetDir, { recursive: true });

	if (process.platform === "darwin") {
		try {
			await execFileAsync("ditto", ["-xk", zipPath, targetDir]);
			return;
		} catch {
			await execFileAsync("unzip", ["-q", "-o", zipPath, "-d", targetDir]);
			return;
		}
	} else if (process.platform === "win32") {
		try {
			await execFileAsync("tar", ["-xf", zipPath, "-C", targetDir]);
			return;
		} catch {
			const psScript = `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`;
			await execFileAsync("powershell", ["-NoProfile", "-Command", psScript]);
			return;
		}
	} else {
		// Linux
		try {
			await execFileAsync("unzip", ["-q", "-o", zipPath, "-d", targetDir]);
			return;
		} catch {
			await execFileAsync("tar", ["-xf", zipPath, "-C", targetDir]);
			return;
		}
	}
}

function verifyRuntimeDir(dirPath: string): boolean {
	const requiredFiles = [
		"daemon.js",
		"extensions/memory.js",
		"extensions/session-state.js",
		"node_modules/@earendil-works/pi-coding-agent/dist/bundle/rpc-entry.js",
	];
	for (const rel of requiredFiles) {
		const full = join(dirPath, rel);
		if (!existsSync(full) || statSync(full).size === 0) {
			return false;
		}
	}
	return true;
}

export class RuntimeUpdateManager {
	private updateInProgress = false;

	public getRuntimeInfo(): RuntimeInfo {
		const userDir = getUserRuntimeDir();
		const builtInDir = getBuiltInRuntimeDir();
		const activeCli = daemonCli();
		const isHot = activeCli.startsWith(userDir);

		const activeDir = isHot ? userDir : builtInDir;
		const manifest = readManifest(activeDir);
		const builtInManifest = readManifest(builtInDir);

		let currentVersion = manifest?.version ?? app?.getVersion?.() ?? "0.2.3";
		let builtInVersion = builtInManifest?.version ?? app?.getVersion?.() ?? "0.2.3";

		return {
			currentVersion,
			piVersion: manifest?.piVersion ?? "0.84.4",
			buildTime: manifest?.buildTime,
			gitCommit: manifest?.gitCommit,
			isHotUpdated: isHot,
			runtimePath: activeDir,
			builtInVersion,
			builtInPath: builtInDir,
		};
	}

	public async checkForUpdates(): Promise<RuntimeUpdateCheckResult> {
		const info = this.getRuntimeInfo();
		const repoUrl = "https://api.github.com/repos/janehuaan/OpenPI/releases/latest";

		try {
			const data = await new Promise<string>((resolve, reject) => {
				const req = https.get(
					repoUrl,
					{
						headers: {
							"User-Agent": "OpenPI-Desktop-RuntimeUpdater",
							Accept: "application/vnd.github.v3+json",
						},
						timeout: 10000,
					},
					(res) => {
						if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
							return reject(new Error(`GitHub API HTTP ${res.statusCode}`));
						}
						let body = "";
						res.setEncoding("utf8");
						res.on("data", (chunk) => (body += chunk));
						res.on("end", () => resolve(body));
					},
				);
				req.on("error", reject);
				req.on("timeout", () => {
					req.destroy();
					reject(new Error("GitHub API request timed out"));
				});
			});

			const release = JSON.parse(data) as {
				tag_name?: string;
				body?: string;
				published_at?: string;
				assets?: Array<{ name: string; browser_download_url: string; size: number }>;
			};

			const tagName = release.tag_name ?? "";
			const latestVersion = tagName.replace(/^v/, "");

			// Find openpi-runtime-v*.zip or openpi-runtime.zip asset
			const asset = release.assets?.find(
				(a) =>
					a.name.startsWith("openpi-runtime") &&
					a.name.endsWith(".zip"),
			);

			const isNewer =
				Boolean(latestVersion && asset && latestVersion !== info.currentVersion);

			return {
				hasUpdate: isNewer,
				currentVersion: info.currentVersion,
				latestVersion,
				releaseNotes: release.body,
				publishedAt: release.published_at,
				assetName: asset?.name,
				assetUrl: asset?.browser_download_url,
				assetSize: asset?.size,
			};
		} catch (err: any) {
			return {
				hasUpdate: false,
				currentVersion: info.currentVersion,
				releaseNotes: `检查更新失败: ${err?.message || String(err)}`,
			};
		}
	}

	public async installFromZip(
		zipPath: string,
		onProgress?: (p: RuntimeUpdateProgress) => void,
	): Promise<{ success: boolean; version?: string; error?: string }> {
		if (this.updateInProgress) {
			return { success: false, error: "已有正在进行的内核更新任务" };
		}
		this.updateInProgress = true;

		const userDir = getUserRuntimeDir();
		const parentDir = dirname(userDir);
		const nextDir = join(parentDir, "runtime.next");
		const prevDir = join(parentDir, "runtime.prev");

		try {
			onProgress?.({ stage: "extracting", percent: 30, message: "正在解压内核文件..." });

			rmSync(nextDir, { recursive: true, force: true });
			await extractZip(zipPath, nextDir);

			// Some zips may contain a single root folder (e.g. openpi-runtime/)
			let rootDir = nextDir;
			if (!existsSync(join(rootDir, "daemon.js"))) {
				const subdirs = ["openpi-runtime", "runtime"];
				for (const sub of subdirs) {
					const candidate = join(nextDir, sub);
					if (existsSync(join(candidate, "daemon.js"))) {
						rootDir = candidate;
						break;
					}
				}
			}

			onProgress?.({ stage: "verifying", percent: 60, message: "校验内核入口完整性..." });
			if (!verifyRuntimeDir(rootDir)) {
				throw new Error("更新包结构不完整，缺少 daemon.js、extensions 或 pi 核心入口");
			}

			onProgress?.({ stage: "restarting", percent: 80, message: "平滑热重启守护中枢..." });

			// Atomic swap
			rmSync(prevDir, { recursive: true, force: true });
			if (existsSync(userDir)) {
				renameSync(userDir, prevDir);
			}

			if (rootDir !== userDir) {
				renameSync(rootDir, userDir);
			}

			// Restart daemon and verify health
			await restartDaemon();
			const client = await ensureDaemon();
			const health = (await client.request({ type: "health" })) as any;

			if (!health?.pid) {
				throw new Error("新内核启动后未通过健康检查响应");
			}

			const manifest = readManifest(userDir);
			const newVersion = manifest?.version ?? "hot-updated";

			// Success - remove old backup
			rmSync(prevDir, { recursive: true, force: true });
			rmSync(nextDir, { recursive: true, force: true });

			onProgress?.({ stage: "completed", percent: 100, message: "内核热更新成功！" });
			return { success: true, version: newVersion };
		} catch (err: any) {
			const errMsg = err?.message || String(err);
			onProgress?.({ stage: "error", percent: 0, message: `热更新失败: ${errMsg}` });

			// Emergency Rollback: restore prevDir if it exists
			try {
				if (existsSync(prevDir)) {
					rmSync(userDir, { recursive: true, force: true });
					renameSync(prevDir, userDir);
				} else if (existsSync(userDir)) {
					rmSync(userDir, { recursive: true, force: true });
				}
				await restartDaemon().catch(() => {});
			} catch {}

			return { success: false, error: errMsg };
		} finally {
			this.updateInProgress = false;
		}
	}

	public async downloadAndApply(
		url: string,
		onProgress?: (p: RuntimeUpdateProgress) => void,
	): Promise<{ success: boolean; version?: string; error?: string }> {
		if (this.updateInProgress) {
			return { success: false, error: "已有正在进行的内核更新任务" };
		}

		const cacheDir = join(homedir(), ".openpi", "cache");
		mkdirSync(cacheDir, { recursive: true });
		const downloadFile = join(cacheDir, `runtime-update-${Date.now()}.zip`);

		try {
			onProgress?.({ stage: "downloading", percent: 5, message: "开始连接下载服务器..." });

			await this.downloadFileWithRedirect(url, downloadFile, (pct) => {
				const mapped = Math.round(5 + pct * 0.25); // 5% -> 30%
				onProgress?.({
					stage: "downloading",
					percent: mapped,
					message: `正在下载最新内核包 (${pct}%)...`,
				});
			});

			return await this.installFromZip(downloadFile, onProgress);
		} catch (err: any) {
			const msg = err?.message || String(err);
			onProgress?.({ stage: "error", percent: 0, message: `下载更新失败: ${msg}` });
			return { success: false, error: msg };
		} finally {
			rmSync(downloadFile, { force: true });
		}
	}

	public async rollbackToBuiltin(): Promise<{ success: boolean; error?: string }> {
		const userDir = getUserRuntimeDir();
		const prevDir = join(dirname(userDir), "runtime.prev");
		try {
			rmSync(prevDir, { recursive: true, force: true });
			if (existsSync(userDir)) {
				renameSync(userDir, prevDir);
			}
			await restartDaemon();
			const client = await ensureDaemon();
			const health = (await client.request({ type: "health" })) as any;
			if (!health?.pid) {
				throw new Error("回滚到内置内核后未通过健康检查");
			}
			rmSync(prevDir, { recursive: true, force: true });
			return { success: true };
		} catch (err: any) {
			// Restore if failed
			if (existsSync(prevDir) && !existsSync(userDir)) {
				renameSync(prevDir, userDir);
			}
			return { success: false, error: err?.message || String(err) };
		}
	}

	private downloadFileWithRedirect(
		url: string,
		destPath: string,
		onProgress: (percent: number) => void,
		redirectCount = 0,
	): Promise<void> {
		if (redirectCount > 5) {
			return Promise.reject(new Error("Too many redirects"));
		}

		return new Promise((resolve, reject) => {
			const lib = url.startsWith("https") ? https : http;
			const req = lib.get(
				url,
				{
					headers: {
						"User-Agent": "OpenPI-Desktop-RuntimeUpdater",
					},
					timeout: 30000,
				},
				(res) => {
					if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
						return this.downloadFileWithRedirect(
							res.headers.location,
							destPath,
							onProgress,
							redirectCount + 1,
						).then(resolve, reject);
					}

					if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
						return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
					}

					const totalBytes = parseInt(res.headers["content-length"] || "0", 10);
					let receivedBytes = 0;
					const fileStream = createWriteStream(destPath);

					res.on("data", (chunk) => {
						receivedBytes += chunk.length;
						if (totalBytes > 0) {
							const pct = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
							onProgress(pct);
						}
					});

					res.pipe(fileStream);

					fileStream.on("finish", () => {
						fileStream.close(() => resolve());
					});

					fileStream.on("error", (err) => {
						rmSync(destPath, { force: true });
						reject(err);
					});
				},
			);

			req.on("error", reject);
			req.on("timeout", () => {
				req.destroy();
				reject(new Error("Download request timed out"));
			});
		});
	}
}

export const runtimeUpdater = new RuntimeUpdateManager();
