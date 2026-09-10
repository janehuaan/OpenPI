import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ExternalLink,
	Globe,
	Monitor,
	MousePointer,
	RefreshCw,
	Smartphone,
	Tablet,
	X,
} from "../../icons";
import { desktopApi } from "../../../api";

export type DeviceViewport = "desktop" | "tablet" | "mobile";

export interface ElementPickedData {
	selector: string;
	tagName: string;
	className?: string;
	id?: string;
	text?: string;
}

export function buildSandboxHtmlDocument(rawHtml?: string): string {
	const raw = rawHtml || "";
	if (raw.includes("<!DOCTYPE html>") || raw.includes("<html")) {
		return raw;
	}
	return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #ffffff;
      color: #0f172a;
    }
    .openpi-inspector-highlight {
      outline: 2px solid #3b82f6 !important;
      outline-offset: 1px !important;
      background-color: rgba(59, 130, 246, 0.1) !important;
      cursor: crosshair !important;
    }
  </style>
</head>
<body>
  ${raw}
  <script>
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'OPENPI_SET_INSPECTOR') {
        window.__openpi_inspector = Boolean(e.data.active);
      }
    });

    document.addEventListener('mouseover', (e) => {
      if (!window.__openpi_inspector) return;
      const el = e.target;
      if (!el || el === document.body) return;
      el.classList.add('openpi-inspector-highlight');
    }, true);

    document.addEventListener('mouseout', (e) => {
      if (!window.__openpi_inspector) return;
      const el = e.target;
      if (el) el.classList.remove('openpi-inspector-highlight');
    }, true);

    document.addEventListener('click', (e) => {
      if (!window.__openpi_inspector) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;
      if (!el) return;
      el.classList.remove('openpi-inspector-highlight');

      let selector = el.tagName.toLowerCase();
      if (el.id) selector += '#' + el.id;
      else if (el.className && typeof el.className === 'string') {
        const cls = el.className.split(/\\s+/).filter(c => c && !c.includes('openpi')).slice(0, 2).join('.');
        if (cls) selector += '.' + cls;
      }

      window.parent.postMessage({
        type: 'OPENPI_ELEMENT_PICKED',
        tagName: el.tagName.toLowerCase(),
        selector,
        className: el.className || '',
        id: el.id || '',
        text: (el.innerText || el.textContent || '').trim().slice(0, 60),
      }, '*');
    }, true);
  </script>
</body>
</html>`;
}

export function LivePreviewPanel({
	defaultHtml,
	defaultUrl = "http://localhost:5173",
	isOpen,
	onClose,
	onInspectElement,
}: {
	defaultHtml?: string;
	defaultUrl?: string;
	isOpen: boolean;
	onClose(): void;
	onInspectElement?(info: ElementPickedData): void;
}) {
	const [mode, setMode] = useState<"sandbox" | "url">(defaultHtml ? "sandbox" : "url");
	const [currentUrl, setCurrentUrl] = useState(defaultUrl);
	const [inputUrl, setInputUrl] = useState(defaultUrl);
	const [viewport, setViewport] = useState<DeviceViewport>("desktop");
	const [inspectorActive, setInspectorActive] = useState(false);
	const [pickedElement, setPickedElement] = useState<ElementPickedData | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);

	const iframeRef = useRef<HTMLIFrameElement>(null);

	// Extract or construct complete HTML with modern styling
	const sandboxDoc = useMemo(() => {
		return buildSandboxHtmlDocument(defaultHtml);
	}, [defaultHtml]);

	// Listen for element inspection events from iframe
	useEffect(() => {
		const handleMessage = (e: MessageEvent) => {
			if (e.data?.type === "OPENPI_ELEMENT_PICKED") {
				const picked: ElementPickedData = {
					selector: e.data.selector,
					tagName: e.data.tagName,
					className: e.data.className,
					id: e.data.id,
					text: e.data.text,
				};
				setPickedElement(picked);
				setInspectorActive(false);
				if (onInspectElement) {
					onInspectElement(picked);
				}
			}
		};
		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [onInspectElement]);

	// Sync inspector toggle into iframe
	useEffect(() => {
		if (iframeRef.current?.contentWindow) {
			iframeRef.current.contentWindow.postMessage(
				{ type: "OPENPI_SET_INSPECTOR", active: inspectorActive },
				"*",
			);
		}
	}, [inspectorActive]);

	const handleRefresh = useCallback(() => {
		setRefreshKey((k) => k + 1);
		if (mode === "url") {
			setCurrentUrl(inputUrl);
		}
	}, [mode, inputUrl]);

	const handleOpenExternal = () => {
		const url = mode === "url" ? currentUrl : undefined;
		if (url) {
			void desktopApi.openExternal(url);
		}
	};

	if (!isOpen) return null;

	const viewportWidth =
		viewport === "mobile" ? "375px" : viewport === "tablet" ? "768px" : "100%";

	return (
		<div className="live-preview-panel" role="region" aria-label="实时预览沙箱">
			{/* Top Bar */}
			<div className="live-preview-toolbar">
				<div className="preview-mode-switch">
					<button
						type="button"
						className={`preview-mode-btn ${mode === "sandbox" ? "active" : ""}`}
						onClick={() => setMode("sandbox")}
						title="渲染当前会话生成的 HTML/UI 组件"
					>
						HTML 沙箱
					</button>
					<button
						type="button"
						className={`preview-mode-btn ${mode === "url" ? "active" : ""}`}
						onClick={() => setMode("url")}
						title="预览本地开发服务器 (如 localhost:5173)"
					>
						本地服务
					</button>
				</div>

				{mode === "url" && (
					<div className="preview-url-bar">
						<Globe size={13} className="url-icon" />
						<input
							type="text"
							className="preview-url-input"
							value={inputUrl}
							onChange={(e) => setInputUrl(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") handleRefresh();
							}}
							placeholder="输入本地网址 (e.g. http://localhost:5173)"
						/>
					</div>
				)}

				<div className="preview-controls">
					{mode === "sandbox" && (
						<button
							type="button"
							className={`preview-tool-btn ${inspectorActive ? "active" : ""}`}
							onClick={() => setInspectorActive((v) => !v)}
							title={inspectorActive ? "退出元素拾取" : "点击拾取页面元素并发送给 AI"}
						>
							<MousePointer size={12} />
							<span>{inspectorActive ? "拾取中…" : "拾取元素"}</span>
						</button>
					)}

					<div className="viewport-segmented">
						<button
							type="button"
							className={`viewport-btn ${viewport === "desktop" ? "active" : ""}`}
							onClick={() => setViewport("desktop")}
							title="桌面全宽"
						>
							<Monitor size={12} />
						</button>
						<button
							type="button"
							className={`viewport-btn ${viewport === "tablet" ? "active" : ""}`}
							onClick={() => setViewport("tablet")}
							title="平板规格 (768px)"
						>
							<Tablet size={12} />
						</button>
						<button
							type="button"
							className={`viewport-btn ${viewport === "mobile" ? "active" : ""}`}
							onClick={() => setViewport("mobile")}
							title="手机规格 (375px)"
						>
							<Smartphone size={12} />
						</button>
					</div>

					<button
						type="button"
						className="preview-tool-btn"
						onClick={handleRefresh}
						title="刷新预览"
					>
						<RefreshCw size={12} />
					</button>

					{mode === "url" && (
						<button
							type="button"
							className="preview-tool-btn"
							onClick={handleOpenExternal}
							title="在系统默认浏览器中打开"
						>
							<ExternalLink size={12} />
						</button>
					)}

					<button
						type="button"
						className="preview-close-btn"
						onClick={onClose}
						title="关闭预览面板"
					>
						<X size={14} />
					</button>
				</div>
			</div>

			{/* Inspector Element Banner */}
			{pickedElement && (
				<div className="picked-element-banner">
					<span>
						已选元素: <code>{pickedElement.selector}</code>
						{pickedElement.text ? ` (${pickedElement.text})` : ""}
					</span>
					<button
						type="button"
						className="btn-clear-picked"
						onClick={() => setPickedElement(null)}
					>
						清除
					</button>
				</div>
			)}

			{/* Frame Area */}
			<div className="live-preview-viewport-container">
				<div
					className="live-preview-viewport-frame"
					style={{ width: viewportWidth }}
				>
					{mode === "sandbox" ? (
						<iframe
							ref={iframeRef}
							key={`sandbox-${refreshKey}`}
							title="OpenPI Live Artifact Sandbox"
							srcDoc={sandboxDoc}
							sandbox="allow-scripts allow-modals"
							className="live-preview-iframe"
						/>
					) : (
						<iframe
							ref={iframeRef}
							key={`url-${refreshKey}`}
							title="OpenPI Live URL Webview"
							src={currentUrl}
							className="live-preview-iframe"
						/>
					)}
				</div>
			</div>
		</div>
	);
}
