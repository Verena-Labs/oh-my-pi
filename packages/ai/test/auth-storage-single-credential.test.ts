import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage } from "@oh-my-pi/pi-ai/auth-storage";
import * as aiStream from "@oh-my-pi/pi-ai/stream";

const PROVIDER = "unit-single-credential";

function oauthCredential(name: string) {
	return {
		type: "oauth" as const,
		access: name,
		refresh: `refresh-${name}`,
		expires: Date.now() + 3_600_000,
		projectId: `project-${name}`,
		email: `${name}@example.com`,
	};
}

describe("AuthStorage single-credential policy", () => {
	let tempDir = "";
	let storage: AuthStorage | undefined;

	beforeEach(async () => {
		vi.spyOn(aiStream, "getEnvApiKey").mockReturnValue(undefined);
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ai-single-credential-"));
		storage = await AuthStorage.create(path.join(tempDir, "agent.db"), { singleCredential: true });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		storage?.close();
		storage = undefined;
		if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
	});

	test("keeps sibling rows but deterministically uses the first matching credential", async () => {
		if (!storage) throw new Error("test setup failed");
		await storage.set(PROVIDER, [oauthCredential("first"), oauthCredential("second")]);

		expect(storage.listStoredCredentials(PROVIDER)).toHaveLength(2);
		expect(await storage.getApiKey(PROVIDER, "session-a")).toBe("first");
		expect(await storage.getApiKey(PROVIDER, "session-b")).toBe("first");
		expect(await storage.getApiKey(PROVIDER)).toBe("first");
	});

	test("never reports a sibling switch after a usage-limit mark", async () => {
		if (!storage) throw new Error("test setup failed");
		await storage.set(PROVIDER, [oauthCredential("first"), oauthCredential("second")]);

		const outcome = await storage.markUsageLimitReached(PROVIDER, "session-a", {
			apiKey: "first",
			retryAfterMs: 1_000,
		});

		expect(outcome.switched).toBe(false);
		expect(await storage.getApiKey(PROVIDER, "session-a")).toBe("first");
	});

	test("irreversibly narrows an injected pooling-capable store", async () => {
		if (!storage) throw new Error("test setup failed");
		storage.close();
		storage = await AuthStorage.create(path.join(tempDir, "injected.db"), { singleCredential: false });
		await storage.set(PROVIDER, [oauthCredential("first"), oauthCredential("second")]);

		storage.enforceSingleCredentialPolicy();
		expect(await storage.getApiKey(PROVIDER, "session-a")).toBe("first");
		const outcome = await storage.markUsageLimitReached(PROVIDER, "session-a", {
			apiKey: "first",
			retryAfterMs: 1_000,
		});

		expect(outcome.switched).toBe(false);
		expect(await storage.getApiKey(PROVIDER, "session-a")).toBe("first");
	});
});
