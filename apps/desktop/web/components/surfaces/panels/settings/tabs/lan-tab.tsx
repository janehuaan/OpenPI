import { type FC, useCallback, useEffect, useState } from "react";
import { desktopApi, type LanStatus } from "../../../../../api";
import { Check, Shield, Smartphone } from "../../../../icons";

/**
 * Desktop side of the phone link: turn the LAN server on/off, mint a pairing code,
 * and revoke paired devices. The switch lives in app_settings.json and only takes
 * effect on the next daemon start (the WS server binds once at startup).
 */
export const LanTab: FC = () => {
	const [status, setStatus] = useState<LanStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [toast, setToast] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			setStatus(await desktopApi.lanStatus());
		} catch {
			/* daemon offline */
		}
	}, []);

	useEffect(() => {
		void load();
		const timer = setInterval(() => void load(), 4000);
		return () => clearInterval(timer);
	}, [load]);

	const flash = (message: string) => {
		setToast(message);
		setTimeout(() => setToast(null), 2600);
	};

	const run = async (action: () => Promise<void>, failure: string) => {
		setBusy(true);
		try {
			await action();
			await load();
		} catch (err) {
			flash(`${failure}：${err instanceof Error ? err.message : String(err)}`);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="settings-scroll-wrapper">
			{toast && (
				<div style={{ padding: "10px 16px", borderRadius: "8px", background: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)", fontSize: "13px", fontWeight: 550, display: "flex", alignItems: "center", gap: "8px" }}>
					<Check size={14} />
					<span>{toast}</span>
				</div>
			)}

			<section className="settings-section-card">
				<div className="settings-section-card-header">
					<div className="settings-section-card-header-left">
						<div className="settings-section-card-icon">
							<Smartphone size={18} />
						</div>
						<div className="settings-section-card-title">
							<h3>局域网遥控 (LAN Remote)</h3>
							<span>让同一 WiFi 下的手机实时观看本机会话并发送指令</span>
						</div>
					</div>
				</div>

				<div className="settings-section-card-body">
					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>总开关 (Master switch)</strong>
							<span>关闭时不接受任何局域网连接。修改在守护进程重启后生效</span>
						</div>
						<div className="setting-item-control">
							<label className="modern-switch">
								<input
									type="checkbox"
									checked={Boolean(status?.enabled)}
									disabled={busy || !status}
									onChange={(e) =>
										void run(async () => {
											await desktopApi.lanSetEnabled(e.target.checked);
											flash(e.target.checked ? "已开启，重启守护进程后生效" : "已关闭，重启守护进程后生效");
										}, "切换失败")
									}
								/>
								<span className="modern-slider" />
							</label>
						</div>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>配对码 (Pairing code)</strong>
							<span>6 位数字，5 分钟内有效且一次性；在手机端「连接 Mac」里输入</span>
						</div>
						<div className="setting-item-control" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
							<code style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: "22px", fontWeight: 700, letterSpacing: "4px", color: status?.code ? "var(--accent)" : "var(--text-tertiary)" }}>
								{status?.code ?? "——————"}
							</code>
							<button
								type="button"
								className="button secondary"
								disabled={busy}
								onClick={() =>
									void run(async () => {
										await desktopApi.lanBeginPairing();
										flash("已生成配对码，同时开启了总开关（重启后生效）");
									}, "生成失败")
								}
							>
								<span>生成配对码</span>
							</button>
						</div>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>监听端口 (Port)</strong>
							<span>局域网 WebSocket 端口，默认 8765</span>
						</div>
						<div className="setting-item-control">
							<span style={{ color: "var(--text-secondary)", fontFamily: "ui-monospace, monospace" }}>
								{status?.port ?? 8765}
							</span>
						</div>
					</div>

					<div className="setting-item-row">
						<div className="setting-item-meta">
							<strong>已配对设备 (Paired devices)</strong>
							<span>撤销后所有手机需重新配对才能连接</span>
						</div>
						<div className="setting-item-control" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
							<span style={{ color: "var(--text-secondary)" }}>{status?.pairedDevices ?? 0}</span>
							<button
								type="button"
								className="button secondary"
								disabled={busy || !status?.pairedDevices}
								onClick={() =>
									void run(async () => {
										await desktopApi.lanRevokeDevices();
										flash("已撤销全部已配对设备");
									}, "撤销失败")
								}
							>
								<span>撤销全部</span>
							</button>
						</div>
					</div>

					<div style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginTop: "4px", color: "var(--text-tertiary)", fontSize: "12px", lineHeight: 1.5 }}>
						<Shield size={14} style={{ flexShrink: 0, marginTop: "1px" }} />
						<span>
							手机发一条消息 = 在本机执行代码，因此需要配对码 + 设备令牌 + 总开关（默认关闭）。局域网内 ws:// 为明文，仅建议同一 WiFi 自用。
						</span>
					</div>
				</div>
			</section>
		</div>
	);
};
