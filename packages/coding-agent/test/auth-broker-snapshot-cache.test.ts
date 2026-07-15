import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SqliteAuthCredentialStore } from "@oh-my-pi/pi-ai";
import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent/sdk";
import { getAgentDbPath, removeWithRetries } from "@oh-my-pi/pi-utils";

const ENV_KEYS = [
	"OMP_AUTH_BROKER_URL",
	"OMP_AUTH_BROKER_TOKEN",
	"OMP_AUTH_BROKER_SNAPSHOT_CACHE",
	"OMP_AUTH_BROKER_SNAPSHOT_TTL_MS",
] as const;
const PROVIDER = "unit-pi-local-auth";
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

describe("Pi credential discovery", () => {
	let tempDir = "";

	beforeEach(async () => {
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agent-pi-local-auth-"));
	});

	afterEach(async () => {
		for (const key of ENV_KEYS) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
		await removeWithRetries(tempDir);
	});

	test("ignores broker environment and opens only the local credential database", async () => {
		const snapshotCachePath = path.join(tempDir, "must-not-exist.enc");
		process.env.OMP_AUTH_BROKER_URL = "http://127.0.0.1:1";
		process.env.OMP_AUTH_BROKER_TOKEN = "must-not-be-read";
		process.env.OMP_AUTH_BROKER_SNAPSHOT_CACHE = snapshotCachePath;

		const store = await SqliteAuthCredentialStore.open(getAgentDbPath(tempDir));
		store.saveApiKey(PROVIDER, "local-api-key");
		store.close();

		const storage = await discoverAuthStorage(tempDir);
		try {
			expect(storage.describeCredentialSource(PROVIDER, "session-a")).toContain("local");
			expect(await storage.getApiKey(PROVIDER, "session-a")).toBe("local-api-key");
			expect(await Bun.file(snapshotCachePath).exists()).toBe(false);
		} finally {
			storage.close();
		}
	});

	test("does not require broker configuration or a network fallback", async () => {
		delete process.env.OMP_AUTH_BROKER_URL;
		delete process.env.OMP_AUTH_BROKER_TOKEN;

		const storage = await discoverAuthStorage(tempDir);
		try {
			expect(await storage.getApiKey(PROVIDER, "session-b")).toBeUndefined();
		} finally {
			storage.close();
		}
	});
});
