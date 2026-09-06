import type { DocumentAttachment, ImageAttachment } from "./app-types";

export interface SessionDraft {
	text: string;
	attachments?: ImageAttachment[];
	documents?: DocumentAttachment[];
}

export class DraftStore {
	private drafts = new Map<string, SessionDraft>();

	getDraft(instanceId: string): SessionDraft | undefined {
		if (!instanceId) return undefined;
		const draft = this.drafts.get(instanceId);
		if (!draft) return undefined;
		return {
			text: draft.text,
			attachments: draft.attachments ? draft.attachments.map((item) => ({ ...item })) : [],
			documents: draft.documents ? draft.documents.map((item) => ({ ...item })) : [],
		};
	}

	setDraft(instanceId: string, draft: SessionDraft): void {
		if (!instanceId) return;
		const text = draft.text ?? "";
		const attachments = draft.attachments ? draft.attachments.map((item) => ({ ...item })) : [];
		const documents = draft.documents ? draft.documents.map((item) => ({ ...item })) : [];

		if (!text.trim() && attachments.length === 0 && documents.length === 0) {
			this.drafts.delete(instanceId);
			return;
		}

		this.drafts.set(instanceId, {
			text,
			attachments,
			documents,
		});
	}

	clearDraft(instanceId: string): void {
		if (!instanceId) return;
		this.drafts.delete(instanceId);
	}

	hasDraft(instanceId: string): boolean {
		if (!instanceId) return false;
		const draft = this.drafts.get(instanceId);
		if (!draft) return false;
		return Boolean(draft.text.trim() || draft.attachments?.length || draft.documents?.length);
	}

	getAllDrafts(): Record<string, SessionDraft> {
		const result: Record<string, SessionDraft> = {};
		for (const [id] of this.drafts) {
			const draft = this.getDraft(id);
			if (draft) result[id] = draft;
		}
		return result;
	}

	clearAllDrafts(): void {
		this.drafts.clear();
	}
}

export const draftStore = new DraftStore();

export const getDraft = (instanceId: string) => draftStore.getDraft(instanceId);
export const setDraft = (instanceId: string, draft: SessionDraft) => draftStore.setDraft(instanceId, draft);
export const clearDraft = (instanceId: string) => draftStore.clearDraft(instanceId);
export const hasDraft = (instanceId: string) => draftStore.hasDraft(instanceId);
