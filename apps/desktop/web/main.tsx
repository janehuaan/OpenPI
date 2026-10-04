import "./lib/tauri-bridge";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./media.css";
import "./speech.css";
import { ErrorBoundary } from "./components/error-boundary";

import { initTheme } from "./lib/theme-manager";
import { initCloudSyncBridge } from "./lib/cloud-sync-bridge";

import { IslandApp } from "./components/IslandApp";
import { MobileApp } from "./mobile/MobileApp";

// Synchronously initialize theme attributes on <html> to prevent flash of wrong theme
initTheme();

const isIsland = typeof window !== "undefined" && window.location.search.includes("window=island");
// The mobile companion is the same bundle behind a different shell: it reads the
// synced cloud data instead of talking to the daemon.
const isMobile = typeof window !== "undefined" && window.location.search.includes("shell=mobile");

if (isIsland) {
	document.documentElement.classList.add("island-mode");
	document.body?.classList.add("island-mode");
}

if (typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent)) {
	document.documentElement.classList.add("platform-darwin");
	document.body?.classList.add("platform-darwin");
}

// Main window only: forward the Supabase session to the daemon for cloud sync.
if (!isIsland) {
	initCloudSyncBridge();
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ErrorBoundary>
			{isIsland ? <IslandApp /> : isMobile ? <MobileApp /> : <App />}
		</ErrorBoundary>
	</StrictMode>,
);
