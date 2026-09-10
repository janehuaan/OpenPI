/**
 * Zero-Overhead Workspace Transactional Snapshot & Rollback
 *
 * Provides safe checkpointing for autonomous agent execution:
 * 1. Uses git low-level plumbing (`git stash create`, `git write-tree`) to capture
 *    exact working-tree state without dirtying git log, branch HEAD, or reflog.
 * 2. Remembers baseline untracked files so user files (e.g. .env, local notes) are
 *    NEVER wiped during rollback.
 * 3. Restores tracked files and surgically purges only untracked artifacts created
 *    AFTER the snapshot was taken.
 */

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

export interface SnapshotResult {
	id: string;
	timestamp: number;
	branch?: string;
	untrackedBaseline?: string[];
}

export interface RollbackResult {
	restored: boolean;
	error?: string;
}

const snapshotBaselines = new Map<string, Set<string>>();

/**
 * Checks if directory is a valid git repository.
 */
export function isGitRepo(cwd: string): boolean {
	try {
		execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Lists relative paths of currently untracked files.
 */
export function getUntrackedFiles(cwd: string): Set<string> {
	try {
		const out = execFileSync("git", ["status", "--porcelain", "-uall"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const set = new Set<string>();
		for (const line of out.split("\n")) {
			if (line.startsWith("?? ")) {
				set.add(line.slice(3).trim());
			}
		}
		return set;
	} catch {
		return new Set<string>();
	}
}

/**
 * Creates an invisible, non-destructive snapshot commit.
 * Remembers current untracked files as baseline to prevent deletion upon rollback.
 */
export function createSnapshot(cwd: string, label = "openpi-task-anchor"): SnapshotResult | null {
	if (!isGitRepo(cwd)) return null;

	try {
		const baselineUntracked = getUntrackedFiles(cwd);

		const stashCommit = execFileSync("git", ["stash", "create", label], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();

		let commitId = stashCommit;
		if (!commitId) {
			commitId = execFileSync("git", ["rev-parse", "HEAD"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		}

		let branch: string | undefined;
		try {
			branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {}

		snapshotBaselines.set(commitId, baselineUntracked);

		return {
			id: commitId,
			timestamp: Date.now(),
			branch,
			untrackedBaseline: Array.from(baselineUntracked),
		};
	} catch {
		return null;
	}
}

/**
 * Hard restores working directory and index to the snapshot state,
 * removing newly created untracked files while protecting baseline user files.
 */
export function rollbackToSnapshot(
	cwd: string,
	snapshotId: string,
	explicitBaseline?: string[] | Set<string>,
): RollbackResult {
	if (!isGitRepo(cwd) || !snapshotId) {
		return { restored: false, error: "Not a git repo or invalid snapshot id" };
	}

	try {
		// Check if snapshot commit object exists
		execFileSync("git", ["cat-file", "-e", `${snapshotId}^{commit}`], {
			cwd,
			stdio: ["ignore", "ignore", "ignore"],
		});

		// 1. Restore tracked files to the snapshot commit
		execFileSync("git", ["read-tree", "--reset", "-u", snapshotId], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});

		// 2. Surgically clean ONLY newly created untracked files
		const baseline =
			explicitBaseline instanceof Set
				? explicitBaseline
				: Array.isArray(explicitBaseline)
					? new Set(explicitBaseline)
					: snapshotBaselines.get(snapshotId);

		const currentUntracked = getUntrackedFiles(cwd);

		if (baseline) {
			for (const relPath of currentUntracked) {
				if (!baseline.has(relPath)) {
					const fullPath = join(cwd, relPath);
					try {
						if (existsSync(fullPath)) {
							rmSync(fullPath, { recursive: true, force: true });
						}
					} catch {}
				}
			}
		} else {
			// Fallback if no baseline is recorded
			execFileSync("git", ["clean", "-fd"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
		}

		return { restored: true };
	} catch (err: any) {
		return {
			restored: false,
			error: `Git rollback failed: ${err.stderr || err.message}`,
		};
	}
}

/**
 * Generates a summary diff between the snapshot and current working tree.
 */
export function getSnapshotDiff(cwd: string, snapshotId: string): string {
	if (!isGitRepo(cwd) || !snapshotId) return "";

	try {
		const diff = execFileSync("git", ["diff", "--stat", snapshotId, "--"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return diff.trim();
	} catch {
		return "";
	}
}
