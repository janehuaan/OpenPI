import { useEffect, useState } from "react";
import type { UserProfile } from "@openpi/shared";
import { api } from "../lib/api.ts";

/**
 * Nickname and avatar emoji.
 *
 * Stored in the isolated agent dir's `user.json`. Both fields are clamped in the
 * daemon: the nickname reaches a prompt, so an unbounded one would be pasted into
 * every turn.
 */
export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const [profile, setProfile] = useState<UserProfile>({});
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();

	useEffect(() => {
		if (!open) return;
		void api
			.getProfile()
			.then(setProfile)
			.catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
	}, [open]);

	if (!open) return null;

	const save = async () => {
		setSaving(true);
		try {
			await api.saveProfile({ nickname: profile.nickname, avatarEmoji: profile.avatarEmoji });
			onClose();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="dialog-backdrop" role="presentation" onClick={onClose}>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close only */}
			<div className="dialog" role="dialog" aria-label="Profile" onClick={(event) => event.stopPropagation()}>
				<h2>Profile</h2>
				{error ? <p className="error">{error}</p> : null}

				<label>
					Nickname <span className="hint">how the agent addresses you</span>
					<input
						value={profile.nickname ?? ""}
						maxLength={40}
						onChange={(event) => setProfile({ ...profile, nickname: event.target.value })}
						placeholder="optional"
					/>
				</label>

				<label>
					Avatar <span className="hint">one emoji</span>
					<input
						value={profile.avatarEmoji ?? ""}
						onChange={(event) => setProfile({ ...profile, avatarEmoji: event.target.value })}
						placeholder="🙂"
					/>
				</label>

				<footer className="dialog-actions">
					<button type="button" onClick={onClose}>
						Cancel
					</button>
					<button type="button" className="primary" onClick={() => void save()} disabled={saving}>
						{saving ? "Saving…" : "Save"}
					</button>
				</footer>
			</div>
		</div>
	);
}
