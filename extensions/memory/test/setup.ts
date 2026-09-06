/**
 * Per-file memory directory isolation for tests.
 *
 * Keeps tests from reading or mutating the user's host ~/.openpi/memory directory
 * and prevents sandbox permission errors (EPERM).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";

let dir: string | undefined;
let previous: string | undefined;

beforeAll(() => {
	previous = process.env.OPENPI_MEMORY_DIR;
	dir = mkdtempSync(join(tmpdir(), "openpi-memory-test-"));
	process.env.OPENPI_MEMORY_DIR = dir;
});

afterAll(() => {
	if (previous === undefined) delete process.env.OPENPI_MEMORY_DIR;
	else process.env.OPENPI_MEMORY_DIR = previous;
	if (dir) rmSync(dir, { recursive: true, force: true });
});
