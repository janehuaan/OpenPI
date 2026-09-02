/**
 * durability.ts coverage: the journal, soft-delete archive, backups, and the
 * three-tier index recovery. This is the "never lose a memory" layer, and the
 * old repo shipped it with no tests - a silent regression here is exactly the
 * kind that is only noticed once data is already gone.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendJournal,
	archiveEntry,
	ARCHIVE_DIR,
	BACKUPS_DIR,
	backupMemoryDirectory,
	ensureDurabilityLayout,
	JOURNAL_FILE,
	journalPath,
	listArchiveCount,
	listArchivedEntries,
	loadActiveOrRecover,
	pruneOldBackups,
	recoverIndex,
} from "../src/durability.ts";
import { generateIndexContent, INDEX_FILE, saveTopicAt } from "../src/store.ts";
import type { MemoryIndexEntry } from "../src/types.ts";

const temporaryDirs: string[] = [];

function makeDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpi-durability-"));
	temporaryDirs.push(dir);
	return dir;
}

function writeIndex(dir: string, entries: MemoryIndexEntry[]): void {
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, INDEX_FILE), generateIndexContent(entries), "utf8");
}

afterEach(() => {
	while (temporaryDirs.length > 0) {
		const dir = temporaryDirs.pop();
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("ensureDurabilityLayout", () => {
	it("creates the archive and backups directories", () => {
		const dir = makeDir();
		ensureDurabilityLayout(dir);
		expect(fs.existsSync(path.join(dir, ARCHIVE_DIR))).toBe(true);
		expect(fs.existsSync(path.join(dir, BACKUPS_DIR))).toBe(true);
	});

	it("is idempotent", () => {
		const dir = makeDir();
		ensureDurabilityLayout(dir);
		expect(() => ensureDurabilityLayout(dir)).not.toThrow();
	});
});

describe("appendJournal", () => {
	it("appends one JSON line per event with a timestamp", () => {
		const dir = makeDir();
		appendJournal(dir, { op: "save", type: "user", key: "tone", value: "concise" });
		appendJournal(dir, { op: "delete", type: "user", key: "tone" });

		const lines = fs
			.readFileSync(journalPath(dir), "utf8")
			.split("\n")
			.filter((line) => line.trim());
		expect(lines).toHaveLength(2);

		const first = JSON.parse(lines[0]);
		expect(first.op).toBe("save");
		expect(first.key).toBe("tone");
		expect(Number.isFinite(Date.parse(first.at))).toBe(true);
	});

	it("writes the journal at the documented filename", () => {
		const dir = makeDir();
		appendJournal(dir, { op: "save", type: "user", key: "k", value: "v" });
		expect(fs.existsSync(path.join(dir, JOURNAL_FILE))).toBe(true);
	});
});

describe("archiveEntry / listArchivedEntries", () => {
	it("writes both the metadata and the topic body, and reads them back", () => {
		const dir = makeDir();
		ensureDurabilityLayout(dir);
		archiveEntry(dir, "project", "old-decision", "we used to do X", "long body about X", "prune");

		const archived = listArchivedEntries(dir);
		expect(archived).toHaveLength(1);
		expect(archived[0]?.key).toBe("old-decision");
		expect(archived[0]?.value).toBe("we used to do X");
		expect(listArchiveCount(dir)).toBe(1);
	});

	it("falls back to the on-disk topic file when no body is passed", () => {
		const dir = makeDir();
		ensureDurabilityLayout(dir);
		saveTopicAt(dir, "lesson", "vitest", "run vitest from the package root");
		archiveEntry(dir, "lesson", "vitest", "vitest lesson");

		const archived = listArchivedEntries(dir);
		expect(archived[0]?.key).toBe("vitest");
	});

	it("respects the limit option", () => {
		const dir = makeDir();
		ensureDurabilityLayout(dir);
		for (let index = 0; index < 5; index++) {
			archiveEntry(dir, "project", `entry-${index}`, `value ${index}`);
		}
		expect(listArchivedEntries(dir, { limit: 3 })).toHaveLength(3);
	});

	it("returns an empty list when nothing was archived", () => {
		const dir = makeDir();
		expect(listArchivedEntries(dir)).toEqual([]);
		expect(listArchiveCount(dir)).toBe(0);
	});

	it("records an archive event in the journal", () => {
		const dir = makeDir();
		ensureDurabilityLayout(dir);
		archiveEntry(dir, "user", "gone", "obsolete preference");
		const events = fs
			.readFileSync(journalPath(dir), "utf8")
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line));
		expect(events.some((event) => event.op === "archive" && event.key === "gone")).toBe(true);
	});
});

describe("backupMemoryDirectory / pruneOldBackups", () => {
	it("copies flat files and stamps the backup with metadata", () => {
		const dir = makeDir();
		writeIndex(dir, [{ type: "user", key: "tone", value: "concise" }]);
		const dest = backupMemoryDirectory(dir, "test-note");

		expect(fs.existsSync(path.join(dest, INDEX_FILE))).toBe(true);
		const meta = JSON.parse(fs.readFileSync(path.join(dest, "_backup-meta.json"), "utf8"));
		expect(meta.note).toBe("test-note");
	});

	it("does not recurse into archive/ or backups/", () => {
		const dir = makeDir();
		ensureDurabilityLayout(dir);
		writeIndex(dir, [{ type: "user", key: "tone", value: "concise" }]);
		archiveEntry(dir, "user", "old", "gone");

		const dest = backupMemoryDirectory(dir);
		expect(fs.existsSync(path.join(dest, ARCHIVE_DIR))).toBe(false);
		expect(fs.existsSync(path.join(dest, BACKUPS_DIR))).toBe(false);
	});

	it("keeps only the newest N backups", () => {
		const dir = makeDir();
		writeIndex(dir, [{ type: "user", key: "tone", value: "concise" }]);
		const backupsRoot = path.join(dir, BACKUPS_DIR);
		fs.mkdirSync(backupsRoot, { recursive: true });
		// Synthesize more backups than the keep limit; real ones are timestamped
		// per second, so creating them in a loop would collide.
		for (let index = 0; index < 8; index++) {
			fs.mkdirSync(path.join(backupsRoot, `2026-01-0${index + 1}T00-00-00-000Z`), { recursive: true });
		}
		pruneOldBackups(dir, 3);
		expect(fs.readdirSync(backupsRoot).length).toBe(3);
	});

	it("creates the directory when backing up a path that does not exist yet", () => {
		const dir = path.join(makeDir(), "not-created-yet");
		expect(() => backupMemoryDirectory(dir)).not.toThrow();
		expect(fs.existsSync(dir)).toBe(true);
	});
});

describe("recoverIndex", () => {
	it("uses the existing index when it is intact", () => {
		const dir = makeDir();
		writeIndex(dir, [
			{ type: "user", key: "tone", value: "concise" },
			{ type: "project", key: "build", value: "npm run check" },
		]);
		const result = recoverIndex(dir, 500);
		expect(result.source).toBe("index");
		expect(result.recovered).toBe(2);
	});

	it("replays the journal when the index is missing", () => {
		const dir = makeDir();
		appendJournal(dir, { op: "save", type: "user", key: "tone", value: "concise" });
		appendJournal(dir, { op: "save", type: "project", key: "build", value: "npm run check" });

		const result = recoverIndex(dir, 500);
		expect(result.source).toBe("journal");
		expect(result.recovered).toBe(2);
		expect(fs.existsSync(path.join(dir, INDEX_FILE))).toBe(true);
	});

	it("applies last-write-wins when the journal saves the same key twice", () => {
		const dir = makeDir();
		appendJournal(dir, { op: "save", type: "user", key: "tone", value: "first" });
		appendJournal(dir, { op: "save", type: "user", key: "tone", value: "second" });

		expect(recoverIndex(dir, 500).recovered).toBe(1);
		expect(fs.readFileSync(path.join(dir, INDEX_FILE), "utf8")).toContain("second");
	});

	it("reports empty when there is nothing to recover from", () => {
		const dir = makeDir();
		expect(recoverIndex(dir, 500).source).toBe("empty");
	});

	it("collapses the index and topic journal entries a save writes for one key", () => {
		// A single memory save journals twice by design: saveIndexAt records the
		// index summary, saveTopicAt records the body needed to rebuild the topic
		// file. Recovery must treat them as one entry, not two.
		const dir = makeDir();
		appendJournal(dir, { op: "save", type: "user", key: "tone", value: "concise" });
		appendJournal(dir, { op: "save", type: "user", key: "tone", value: "concise", body: "full body" });

		expect(recoverIndex(dir, 500).recovered).toBe(1);
	});

	it("recovers from topic files when index and journal are both gone", () => {
		const dir = makeDir();
		saveTopicAt(dir, "lesson", "vitest", "run vitest from the package root");
		const result = recoverIndex(dir, 500);
		expect(["topics", "journal"]).toContain(result.source);
		expect(result.recovered).toBeGreaterThan(0);
	});
});

describe("loadActiveOrRecover", () => {
	it("returns the active index without touching recovery", () => {
		const dir = makeDir();
		writeIndex(dir, [{ type: "user", key: "tone", value: "concise" }]);
		const entries = loadActiveOrRecover(dir, 500);
		expect(entries).toHaveLength(1);
		expect(entries[0]?.key).toBe("tone");
	});

	it("rebuilds from the journal when the index was deleted", () => {
		const dir = makeDir();
		appendJournal(dir, { op: "save", type: "user", key: "tone", value: "concise" });
		const entries = loadActiveOrRecover(dir, 500);
		expect(entries.map((entry) => entry.key)).toContain("tone");
	});

	it("returns an empty array for a fresh directory", () => {
		expect(loadActiveOrRecover(makeDir(), 500)).toEqual([]);
	});
});
