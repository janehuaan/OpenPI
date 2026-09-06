import { describe, expect, it, beforeEach } from "vitest";
import { DraftStore, draftStore } from "./draft-store";
import type { DocumentAttachment, ImageAttachment } from "./app-types";

describe("draftStore", () => {
	let store: DraftStore;

	beforeEach(() => {
		store = new DraftStore();
		draftStore.clearAllDrafts();
	});

	it("returns undefined for non-existent drafts or empty instanceId", () => {
		expect(store.getDraft("")).toBeUndefined();
		expect(store.getDraft("inst-none")).toBeUndefined();
		expect(store.hasDraft("inst-none")).toBe(false);
	});

	it("saves and retrieves draft text", () => {
		store.setDraft("inst-1", { text: "Hello draft" });
		expect(store.hasDraft("inst-1")).toBe(true);
		const retrieved = store.getDraft("inst-1");
		expect(retrieved).toBeDefined();
		expect(retrieved?.text).toBe("Hello draft");
		expect(retrieved?.attachments).toEqual([]);
		expect(retrieved?.documents).toEqual([]);
	});

	it("saves and retrieves draft with attachments and documents", () => {
		const sampleImage: ImageAttachment = {
			id: "img-1",
			name: "screenshot.png",
			type: "image",
			mimeType: "image/png",
			data: "base64data",
		};
		const sampleDoc: DocumentAttachment = {
			id: "doc-1",
			name: "notes.txt",
			text: "Note content",
			path: "/path/to/notes.txt",
		};

		store.setDraft("inst-2", {
			text: "With files",
			attachments: [sampleImage],
			documents: [sampleDoc],
		});

		const retrieved = store.getDraft("inst-2");
		expect(retrieved?.text).toBe("With files");
		expect(retrieved?.attachments).toHaveLength(1);
		expect(retrieved?.attachments?.[0].id).toBe("img-1");
		expect(retrieved?.documents).toHaveLength(1);
		expect(retrieved?.documents?.[0].id).toBe("doc-1");

		// Verify defensive copying: mutating retrieved doesn't mutate store
		retrieved?.attachments?.push({
			id: "img-2",
			name: "other.png",
			type: "image",
			mimeType: "image/png",
			data: "data2",
		});
		const retrievedAgain = store.getDraft("inst-2");
		expect(retrievedAgain?.attachments).toHaveLength(1);
	});

	it("automatically removes draft when text and attachments are empty", () => {
		store.setDraft("inst-3", { text: "Some draft" });
		expect(store.hasDraft("inst-3")).toBe(true);

		// Set empty text and no attachments
		store.setDraft("inst-3", { text: "   ", attachments: [], documents: [] });
		expect(store.hasDraft("inst-3")).toBe(false);
		expect(store.getDraft("inst-3")).toBeUndefined();
	});

	it("clears draft explicitly", () => {
		store.setDraft("inst-4", { text: "To be cleared" });
		expect(store.hasDraft("inst-4")).toBe(true);
		store.clearDraft("inst-4");
		expect(store.hasDraft("inst-4")).toBe(false);
		expect(store.getDraft("inst-4")).toBeUndefined();
	});

	it("maintains separate drafts for different session instanceIds", () => {
		store.setDraft("inst-a", { text: "Draft for session A" });
		store.setDraft("inst-b", { text: "Draft for session B" });

		expect(store.getDraft("inst-a")?.text).toBe("Draft for session A");
		expect(store.getDraft("inst-b")?.text).toBe("Draft for session B");

		store.clearDraft("inst-a");
		expect(store.getDraft("inst-a")).toBeUndefined();
		expect(store.getDraft("inst-b")?.text).toBe("Draft for session B");
	});

	it("getAllDrafts and clearAllDrafts work as expected", () => {
		store.setDraft("inst-1", { text: "Draft 1" });
		store.setDraft("inst-2", { text: "Draft 2" });

		const all = store.getAllDrafts();
		expect(Object.keys(all)).toEqual(["inst-1", "inst-2"]);
		expect(all["inst-1"].text).toBe("Draft 1");

		store.clearAllDrafts();
		expect(store.getAllDrafts()).toEqual({});
		expect(store.getDraft("inst-1")).toBeUndefined();
	});

	it("handles singleton draftStore instance", () => {
		draftStore.setDraft("global-inst", { text: "Singleton draft" });
		expect(draftStore.getDraft("global-inst")?.text).toBe("Singleton draft");
		draftStore.clearDraft("global-inst");
		expect(draftStore.getDraft("global-inst")).toBeUndefined();
	});
});
