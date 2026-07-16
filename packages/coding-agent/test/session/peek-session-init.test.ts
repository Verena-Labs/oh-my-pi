import { afterEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

const tempDirs: TempDir[] = [];

function makeTempDir(prefix: string): string {
	const dir = TempDir.createSync(prefix);
	tempDirs.push(dir);
	return dir.path();
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => dir.remove()));
});

function assistantMessage(text: string) {
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Expected built-in anthropic model to exist");
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

describe("SessionManager.peekSessionInit", () => {
	it("returns the latest session_init contract (tools/spawns/readSummarize) and the header cwd", async () => {
		const cwd = makeTempDir("@pi-peek-cwd-");
		const manager = SessionManager.create(cwd, path.join(cwd, "sessions"));
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("Expected a persisted session file path");

		manager.appendSessionInit({ systemPrompt: "first", task: "t1", tools: ["read"], spawns: "" });
		manager.appendSessionInit({
			systemPrompt: "second",
			task: "t2",
			tools: ["read", "bash", "yield"],
			spawns: "task",
			readSummarize: false,
			workerKind: "ultra",
			agentName: "ultra",
			agentId: "Worker",
		});
		// Flush buffered entries (header + inits) so the lock-free peek can read them off disk.
		manager.appendMessage(assistantMessage("flush"));

		const peek = await SessionManager.peekSessionInit(sessionFile);
		expect(peek?.cwd).toBe(manager.getCwd());
		// Latest init wins — the reviver must rebuild from the most recent contract.
		expect(peek?.init?.systemPrompt).toBe("second");
		expect(peek?.init?.tools).toEqual(["read", "bash", "yield"]);
		expect(peek?.init?.spawns).toBe("task");
		expect(peek?.init?.readSummarize).toBe(false);
		expect(peek?.init?.workerKind).toBe("ultra");
		expect(peek?.init?.agentName).toBe("ultra");
		expect(peek?.init?.agentId).toBe("Worker");
	});

	it("returns init: null for a session file with no session_init (a main/legacy session)", async () => {
		const cwd = makeTempDir("@pi-peek-legacy-");
		const manager = SessionManager.create(cwd, path.join(cwd, "sessions"));
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("Expected a persisted session file path");
		manager.appendMessage(assistantMessage("hi"));

		const peek = await SessionManager.peekSessionInit(sessionFile);
		expect(peek?.cwd).toBe(manager.getCwd());
		expect(peek?.init).toBeNull();
	});

	it("returns null for a file that cannot be read", async () => {
		const peek = await SessionManager.peekSessionInit(path.join(makeTempDir("@pi-peek-missing-"), "nope.jsonl"));
		expect(peek).toBeNull();
	});
});

describe("SessionManager Ultra worker roster journal", () => {
	it("reconstructs an addressable roster after the owning session is closed and reopened", async () => {
		const cwd = makeTempDir("@pi-ultra-roster-reopen-");
		const manager = SessionManager.create(cwd, path.join(cwd, "sessions"));
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("Expected a persisted owner session file");
		manager.appendUltraWorkerLifecycle({
			workerId: "ColdWorker",
			action: "spawn",
			ownerId: "Main",
			workerParentId: "Main",
			sessionFile: path.join(sessionFile.slice(0, -6), "ColdWorker.jsonl"),
			modelOverride: "openai/gpt-test",
			createdAt: 100,
			turns: 3,
		});
		await manager.flush();
		await manager.close();

		const reopened = await SessionManager.open(sessionFile, undefined, undefined, { suppressBreadcrumb: true });
		try {
			expect(reopened.getActiveUltraWorkerRoster("Main")).toEqual([
				expect.objectContaining({
					workerId: "ColdWorker",
					action: "spawn",
					modelOverride: "openai/gpt-test",
					createdAt: 100,
					turns: 3,
				}),
			]);
		} finally {
			await reopened.close();
		}
	});

	it("reconstructs active workers per owner across spawn, kill, clear, and respawn markers", () => {
		const manager = SessionManager.inMemory(makeTempDir("@pi-ultra-roster-"));
		manager.appendUltraWorkerLifecycle({
			workerId: "A",
			action: "spawn",
			ownerId: "Main",
			workerParentId: "Main",
			sessionFile: "/tmp/A.jsonl",
			modelOverride: "openai/gpt-test",
			createdAt: 100,
		});
		manager.appendUltraWorkerLifecycle({
			workerId: "B",
			action: "spawn",
			ownerId: "Main",
			sessionFile: "/tmp/B.jsonl",
		});
		manager.appendUltraWorkerLifecycle({ workerId: "A", action: "kill", ownerId: "Main", reason: "done" });
		manager.appendUltraWorkerLifecycle({
			workerId: "Other",
			action: "spawn",
			ownerId: "Nested",
			sessionFile: "/tmp/Other.jsonl",
		});

		expect(manager.getActiveUltraWorkerRoster("Main").map(entry => entry.workerId)).toEqual(["B"]);
		expect(manager.getActiveUltraWorkerRoster("Nested").map(entry => entry.workerId)).toEqual(["Other"]);

		manager.appendUltraWorkerLifecycle({ workerId: "*", action: "clear", ownerId: "Main", reason: "exit" });
		expect(manager.getActiveUltraWorkerRoster("Main")).toEqual([]);
		expect(manager.getActiveUltraWorkerRoster("Nested").map(entry => entry.workerId)).toEqual(["Other"]);

		manager.appendUltraWorkerLifecycle({
			workerId: "C",
			action: "spawn",
			ownerId: "Main",
			sessionFile: "/tmp/C.jsonl",
			turns: 2,
		});
		const active = manager.getActiveUltraWorkerRoster("Main");
		expect(active).toHaveLength(1);
		expect(active[0]?.workerId).toBe("C");
		expect(active[0]?.turns).toBe(2);
	});

	it("ignores malformed ids and forward lifecycle actions instead of treating them as spawns", () => {
		const manager = SessionManager.inMemory(makeTempDir("@pi-ultra-roster-forward-entry-"));
		manager.appendUltraWorkerLifecycle({
			workerId: "Preserved",
			action: "spawn",
			ownerId: "Main",
			sessionFile: "/tmp/Preserved.jsonl",
		});
		manager.appendUltraWorkerLifecycle({
			workerId: "FutureWorker",
			action: "hibernate" as never,
			ownerId: "Main",
			sessionFile: "/tmp/FutureWorker.jsonl",
		});
		manager.appendUltraWorkerLifecycle({
			workerId: 42 as never,
			action: "spawn",
			ownerId: "Main",
			sessionFile: "/tmp/NumberWorker.jsonl",
		});

		expect(manager.getActiveUltraWorkerRoster("Main").map(entry => entry.workerId)).toEqual(["Preserved"]);
	});
});
