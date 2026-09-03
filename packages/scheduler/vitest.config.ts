import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// One scheduler directory per test file: the store's paths resolve lazily,
		// so this keeps the module-level taskStore singleton off ~/.openpi.
		setupFiles: ["./test/setup.ts"],
	},
});
