import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: "web",
	// Relative asset URLs. The packaged app loads index.html over file://, where a
	// root-absolute "/assets/..." resolves to the filesystem root and the page
	// renders blank with no error in the terminal.
	base: "./",
	// The old desktop installed @vitejs/plugin-react at the repo root but never
	// used it here, so every UI edit was a full page reload instead of a Fast
	// Refresh update.
	plugins: [react()],
	build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
	server: { host: "127.0.0.1", port: 5179, strictPort: true },
});
