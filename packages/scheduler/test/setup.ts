/**
 * Per-file scheduler directory isolation.
 *
 * TaskStore resolves its paths lazily on every call, so pointing
 * OPENPI_SCHEDULER_DIR at a fresh temp directory before each test file loads is
 * enough to keep the module-level `taskStore` singleton off the real one.
 *
 * Without this, the ported tests wrote into ~/.openpi/scheduler and leaked state
 * between files - which is how the original suite produced a run count of 7
 * where it expected 1.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

let dir: string | undefined;
let previous: string | undefined;

beforeAll(() => {
	previous = process.env.OPENPI_SCHEDULER_DIR;
	dir = mkdtempSync(join(tmpdir(), "openpi-scheduler-test-"));
	process.env.OPENPI_SCHEDULER_DIR = dir;
});

afterAll(() => {
	if (previous === undefined) delete process.env.OPENPI_SCHEDULER_DIR;
	else process.env.OPENPI_SCHEDULER_DIR = previous;
	if (dir) rmSync(dir, { recursive: true, force: true });
});
