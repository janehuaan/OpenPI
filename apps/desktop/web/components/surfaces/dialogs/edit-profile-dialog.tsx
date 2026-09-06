import { useState } from "react";
import { X } from "../../icons.tsx";

export function EditProfileDialog({
	profile,
	busy,
	onClose,
	onSave,
}: {
	profile: { nickname?: string; avatarEmoji?: string };
	busy: boolean;
	onClose(): void;
	onSave(profile: { nickname?: string; avatarEmoji?: string }): Promise<void>;
}) {
	const [nickname, setNickname] = useState(profile.nickname ?? "");
	const [avatarEmoji, setAvatarEmoji] = useState(profile.avatarEmoji ?? "");
	return (
		<div
			className="dialog-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget && !busy) onClose();
			}}
		>
			<form
				className="dialog conversation-dialog"
				onSubmit={(event) => {
					event.preventDefault();
					void onSave({ nickname: nickname.trim(), avatarEmoji: avatarEmoji.trim() || undefined });
				}}
			>
				<div className="dialog-header">
					<div>
						<span className="eyebrow">本地档案</span>
						<h2>编辑资料</h2>
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
				<label>
					昵称
					<input
						autoFocus
						maxLength={40}
						value={nickname ?? ""}
						onChange={(event) => setNickname(event.target.value)}
						placeholder="你的名字"
					/>
				</label>
				<label>
					头像表情
					<input
						maxLength={4}
						value={avatarEmoji ?? ""}
						onChange={(event) => setAvatarEmoji(event.target.value)}
						placeholder="如 🧑‍💻"
					/>
				</label>
				<div className="dialog-actions">
					<button type="button" className="button" disabled={busy} onClick={onClose}>
						取消
					</button>
					<button className="button primary" disabled={busy || nickname.trim().length === 0}>
						{busy ? "保存中…" : "保存"}
					</button>
				</div>
			</form>
		</div>
	);
}
