import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, RefreshCw } from "./icons";

interface Props {
	children: ReactNode;
	fallbackView?: () => void;
}

interface State {
	hasError: boolean;
	error: Error | null;
	errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, error: null, errorInfo: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error, errorInfo: null };
	}

	override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
		console.error("ErrorBoundary caught an unhandled React error:", error, errorInfo);
		this.setState({ errorInfo });
		if (typeof window !== "undefined" && (window as any).__TAURI_INTERNALS__) {
			try {
				(window as any).openpi?.invoke?.("log_error", {
					msg: String(error?.message || error),
					stack: error?.stack,
					componentStack: errorInfo?.componentStack,
				});
			} catch {}
		}
	}

	handleReset = () => {
		this.setState({ hasError: false, error: null, errorInfo: null });
		if (this.props.fallbackView) {
			this.props.fallbackView();
		}
	};

	override render(): ReactNode {
		if (this.state.hasError) {
			return (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						justifyContent: "center",
						height: "100%",
						width: "100%",
						padding: "32px",
						boxSizing: "border-box",
						color: "var(--text, #1e293b)",
						background: "var(--bg, #f8fafc)",
						fontFamily: "system-ui, -apple-system, sans-serif",
					}}
				>
					<div
						style={{
							maxWidth: "560px",
							width: "100%",
							padding: "28px",
							borderRadius: "16px",
							background: "var(--bg-card, #ffffff)",
							border: "1px solid var(--border, #e2e8f0)",
							boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.08)",
							textAlign: "center",
						}}
					>
						<div
							style={{
								width: "48px",
								height: "48px",
								borderRadius: "12px",
								background: "rgba(239, 68, 68, 0.12)",
								color: "#ef4444",
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								marginBottom: "16px",
							}}
						>
							<AlertCircle size={24} />
						</div>
						<h2 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: 650 }}>页面加载遇到异常</h2>
						<p style={{ margin: "0 0 20px", fontSize: "13px", color: "var(--text-secondary, #64748b)", lineHeight: 1.6 }}>
							当前页面组件未能正常渲染。已保护底层守护进程与对话上下文。您可以点击返回主对话界面。
						</p>

						<div
							style={{
								background: "rgba(15, 23, 42, 0.04)",
								border: "1px solid rgba(15, 23, 42, 0.08)",
								borderRadius: "8px",
								padding: "12px",
								marginBottom: "20px",
								fontSize: "12px",
								fontFamily: "monospace",
								color: "#dc2626",
								textAlign: "left",
								maxHeight: "120px",
								overflow: "auto",
								wordBreak: "break-all",
							}}
						>
							{this.state.error?.message || String(this.state.error)}
						</div>

						<div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
							<button
								type="button"
								onClick={this.handleReset}
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: "6px",
									padding: "8px 16px",
									borderRadius: "8px",
									border: "none",
									background: "var(--accent, #3b82f6)",
									color: "#ffffff",
									fontSize: "13px",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								<ArrowLeft size={14} />
								<span>返回对话</span>
							</button>

							<button
								type="button"
								onClick={() => window.location.reload()}
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: "6px",
									padding: "8px 16px",
									borderRadius: "8px",
									border: "1px solid var(--border, #e2e8f0)",
									background: "transparent",
									color: "var(--text, #1e293b)",
									fontSize: "13px",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								<RefreshCw size={14} />
								<span>重新加载</span>
							</button>
						</div>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
