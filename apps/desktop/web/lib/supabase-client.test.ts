import { describe, it, expect, beforeEach, vi } from "vitest";
import { SupabaseClient } from "./supabase-client";

// Mock localStorage for Node environment
const mockStorage: Record<string, string> = {};
(globalThis as any).localStorage = {
	getItem: (key: string) => mockStorage[key] ?? null,
	setItem: (key: string, val: string) => {
		mockStorage[key] = String(val);
	},
	removeItem: (key: string) => {
		delete mockStorage[key];
	},
	clear: () => {
		for (const k of Object.keys(mockStorage)) {
			delete mockStorage[k];
		}
	},
};

describe("SupabaseClient", () => {
	let client: SupabaseClient;

	beforeEach(() => {
		localStorage.clear();
		vi.restoreAllMocks();
		client = new SupabaseClient();
	});

	it("initializes with default project when no settings in localStorage", () => {
		expect(client.isConfigured()).toBe(true);
		expect(client.getConfig().url).toBe("https://ibohdnslftdpvixwaxkd.supabase.co");
		expect(client.getUser()).toBeNull();
		expect(client.getSession()).toBeNull();
	});

	it("saves and loads configuration properly", () => {
		client.saveConfig({
			url: "https://myproject.supabase.co/",
			anonKey: "my-anon-key-123",
		});

		expect(client.isConfigured()).toBe(true);
		expect(client.getConfig().url).toBe("https://myproject.supabase.co");
		expect(client.getConfig().anonKey).toBe("my-anon-key-123");

		// New instance should read from localStorage
		const anotherClient = new SupabaseClient();
		expect(anotherClient.isConfigured()).toBe(true);
		expect(anotherClient.getConfig().url).toBe("https://myproject.supabase.co");
	});

	it("signs in successfully with email and password", async () => {
		client.saveConfig({
			url: "https://mock.supabase.co",
			anonKey: "mock-key",
		});

		const mockUser = {
			id: "usr_123",
			email: "user@example.com",
			user_metadata: { nickname: "TestUser", avatar_emoji: "🚀" },
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				access_token: "token_abc",
				refresh_token: "refresh_xyz",
				expires_in: 3600,
				user: mockUser,
			}),
		} as any);

		const result = await client.signIn("user@example.com", "password123");

		expect(result.error).toBeUndefined();
		expect(result.user?.id).toBe("usr_123");
		expect(client.getUser()?.email).toBe("user@example.com");
		expect(client.getSession()?.access_token).toBe("token_abc");
	});

	it("handles login failure gracefully", async () => {
		client.saveConfig({
			url: "https://mock.supabase.co",
			anonKey: "mock-key",
		});

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: async () => ({
				error: "invalid_grant",
				error_description: "Invalid login credentials",
			}),
		} as any);

		const result = await client.signIn("user@example.com", "wrongpass");
		expect(result.error).toBe("Invalid login credentials");
		expect(client.getUser()).toBeNull();
	});

	it("signs out cleanly and removes session", async () => {
		client.saveConfig({
			url: "https://mock.supabase.co",
			anonKey: "mock-key",
		});

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				access_token: "token_abc",
				refresh_token: "refresh_xyz",
				user: { id: "usr_123", email: "user@example.com" },
			}),
		} as any);

		await client.signIn("user@example.com", "password123");
		expect(client.getUser()).not.toBeNull();

		await client.signOut();
		expect(client.getUser()).toBeNull();
		expect(client.getSession()).toBeNull();
	});
});
