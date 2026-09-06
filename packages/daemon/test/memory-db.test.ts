import assert from "node:assert/strict";
import test, { describe, it } from "node:test";
import { MemoryDb } from "../src/memory/memory-db.ts";

describe("MemoryDb SQLite State Machine", () => {
	it("initializes schema and tables in in-memory mode", () => {
		const db = new MemoryDb(":memory:");
		const stats = db.getJobStats();
		assert.deepEqual(stats, {
			pending: 0,
			running: 0,
			completed: 0,
			failed: 0,
			unconsolidatedStage1: 0,
		});
		db.close();
	});

	it("enqueues and claims jobs with atomic lease and ownership token", () => {
		const db = new MemoryDb(":memory:");
		db.enqueueJob("memory_stage1", "session-1", { inputWatermark: 1000 });

		const claimed = db.claimNextJob("worker-a", ["memory_stage1"], 5000);
		assert.notEqual(claimed, null);
		assert.equal(claimed?.job.kind, "memory_stage1");
		assert.equal(claimed?.job.job_key, "session-1");
		assert.equal(claimed?.job.status, "running");
		assert.equal(claimed?.job.worker_id, "worker-a");
		assert.equal(typeof claimed?.ownershipToken, "string");

		// Another worker cannot claim the same running job
		const secondClaim = db.claimNextJob("worker-b", ["memory_stage1"], 5000);
		assert.equal(secondClaim, null);

		// Complete the job with matching ownership token
		const completed = db.completeJob(
			"memory_stage1",
			"session-1",
			claimed!.ownershipToken,
			1000,
		);
		assert.equal(completed, true);

		const updated = db.getJob("memory_stage1", "session-1");
		assert.equal(updated?.status, "completed");
		assert.equal(updated?.ownership_token, null);
		assert.equal(updated?.last_success_watermark, 1000);

		db.close();
	});

	it("handles failure with retry decrement and schedule", () => {
		const db = new MemoryDb(":memory:");
		db.enqueueJob("memory_stage1", "session-fail", { retryRemaining: 2 });

		const claimed = db.claimNextJob("worker-a", ["memory_stage1"]);
		assert.notEqual(claimed, null);

		const failed = db.failJob(
			"memory_stage1",
			"session-fail",
			claimed!.ownershipToken,
			"Network timeout",
			10_000,
		);
		assert.equal(failed, true);

		const jobAfterFail = db.getJob("memory_stage1", "session-fail");
		assert.equal(jobAfterFail?.status, "failed");
		assert.equal(jobAfterFail?.retry_remaining, 1);
		assert.equal(jobAfterFail?.last_error, "Network timeout");
		assert.ok(jobAfterFail?.retry_at && jobAfterFail.retry_at > Date.now());

		db.close();
	});

	it("stores and selects stage1 outputs correctly", () => {
		const db = new MemoryDb(":memory:");
		db.saveStage1Output({
			thread_id: "thread-123",
			source_updated_at: 1000,
			raw_memory: "- The project uses Vitest\n- macOS needs entitlement",
			rollout_summary: "Fixed build scripts on macOS by modifying package.json.",
			rollout_slug: "macos-build-fix",
			generated_at: 1050,
		});

		const output = db.getStage1Output("thread-123");
		assert.ok(output);
		assert.ok(output?.raw_memory.includes("Vitest"));
		assert.equal(output?.rollout_slug, "macos-build-fix");
		assert.equal(output?.selected_for_phase2, 0);

		const unconsolidated = db.getUnconsolidatedStage1Outputs();
		assert.equal(unconsolidated.length, 1);
		assert.equal(unconsolidated[0].thread_id, "thread-123");

		// Mark selected for phase 2
		db.markStage1OutputsSelected(["thread-123"]);
		const remaining = db.getUnconsolidatedStage1Outputs();
		assert.equal(remaining.length, 0);

		const outputAfter = db.getStage1Output("thread-123");
		assert.equal(outputAfter?.selected_for_phase2, 1);
		assert.ok(outputAfter?.selected_for_phase2_source_updated_at && outputAfter.selected_for_phase2_source_updated_at > 0);

		db.close();
	});
});
