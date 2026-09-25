import "./lib/tauri-bridge";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./media.css";
import "./speech.css";
import { ErrorBoundary } from "./components/error-boundary";

import { initTheme } from "./lib/theme-manager";

// Synchronously initialize theme attributes on <html> to prevent flash of wrong theme
initTheme();

if (typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent)) {
	document.documentElement.classList.add("platform-darwin");
	document.body?.classList.add("platform-darwin");
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</StrictMode>,
);
