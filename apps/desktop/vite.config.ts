import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: "web",
	// The old desktop installed @vitejs/plugin-react at the repo root but never
	// used it here, so every UI edit was a full page reload instead of a Fast
	// Refresh update.
	plugins: [react()],
	build: { outDir: "../dist", emptyOutDir: true },
	server: { port: 5179, strictPort: true },
});
