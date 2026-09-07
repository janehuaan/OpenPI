import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./media.css";
import "./speech.css";
if (typeof navigator !== "undefined" && /Macintosh|Mac OS X/i.test(navigator.userAgent)) {
	document.documentElement.classList.add("platform-darwin");
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
