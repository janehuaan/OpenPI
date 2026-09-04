import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { environment: "node", include: ["{web,electron,test}/**/*.test.ts"] },
});
