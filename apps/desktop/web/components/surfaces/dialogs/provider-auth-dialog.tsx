import { ExternalLink, RefreshCw, X } from "../../icons.tsx";

export function ProviderAuthDialog({
	auth,
	busy,
	onClose,
	onOpenUrl,
	onDone,
}: {
	auth: {
		provider: string;
		url?: string;
		userCode?: string;
		status: "pending" | "completed" | "failed";
		message?: string;
	};
	busy: boolean;
	onClose(): void;
	onOpenUrl(url: string): void;
	onDone(): void;
}) {
	return (
		<div className="dialog-backdrop">
			<div className="dialog conversation-dialog auth-dialog">
				<div className="dialog-header">
					<div>
						<span className="eyebrow">服务商登录</span>
						<h2>{auth.provider}</h2>
					</div>
					<button
						type="button"
						className="icon-button quiet"
						title="关闭"
						aria-label="关闭"
						disabled={busy}
						onClick={onClose}
					>
						<X size={17} />
					</button>
				</div>

				{auth.status === "pending" && (
					<>
						<p className="ui-request-message">
							{auth.userCode ? (
								<>
									请在浏览器中打开下面的链接，并输入验证码：
									<strong className="auth-user-code">{auth.userCode}</strong>
								</>
							) : (
								"请在浏览器中完成授权。"
							)}
						</p>
						{auth.url && (
							<button
								type="button"
								className="button primary"
								disabled={busy}
								onClick={() => onOpenUrl(auth.url ?? "")}
							>
								<ExternalLink size={15} />
								打开浏览器
							</button>
						)}
						{auth.message && <p className="ui-request-message muted">{auth.message}</p>}
						<div className="auth-spinner-row">
							<RefreshCw size={15} className="spin" />
							<span>等待授权完成…</span>
						</div>
					</>
				)}

				{auth.status === "completed" && (
					<>
						<p className="ui-request-message">登录成功，模型列表已刷新。</p>
						<div className="dialog-actions">
							<button type="button" className="button primary" onClick={onDone}>
								完成
							</button>
						</div>
					</>
				)}

				{auth.status === "failed" && (
					<>
						<p className="ui-request-message error-text">登录失败：{auth.message ?? "未知错误"}</p>
						<div className="dialog-actions">
							<button type="button" className="button primary" onClick={onDone}>
								关闭
							</button>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
