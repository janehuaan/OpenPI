/**
 * CJS bootstrap for Electron.
 *
 * Electron 37.x bundles Node 22.17 which crashes in the ESM->CJS translator
 * (`cjsPreparseModuleExports`) when the app main is an ES module on this
 * platform (Intel macOS). Loading the real main via a CJS entry avoids that
 * code path: `require("electron")` uses the CJS loader, and the ESM main is
 * then imported from a CJS host.
 */
const { app } = require("electron");

// Ensure the app is initialized before the async import resolves so the
// window code in main.mjs can rely on Electron APIs immediately.
app.whenReady().then(() => {
	void import("./main.mjs").catch((error) => {
		console.error("Failed to load main.mjs:", error);
		app.quit();
	});
});
