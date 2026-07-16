/**
 * Contracts: Ultra worker-session registry lifecycle.
 *
 * 1. `spawn` returns immediately (session id + turn job id) while the turn
 *    runs in the background; the settled turn self-delivers a result carrying
 *    the activity trace AND the worker's response, and the session stays
 *    addressable (idle) afterwards.
 * 2. `send` routes by state: steering into a streaming mid-turn worker,
 *    queueing when the worker is mid-turn but not steerable (drained into the
 *    next turn automatically), and starting a follow-up turn on the SAME
 *    worker id when idle.
 * 3. `runSubagentFollowUpTurn` continues a live session in place: consecutive
 *    turns hit the same AgentSession instance (context retained) and the
 *    finalized result carries the yield payload + tool trace.
 * 4. `wait` wakes on the FIRST settling turn among concurrent sessions and
 *    acknowledges its delivery so the result is not delivered twice.
 * 5. `kill` cancels the in-flight turn job and releases the worker session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { UltraWorkerLifecycleEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import * as executorModule from "@oh-my-pi/pi-coding-agent/task/executor";
import type { AgentDefinition, AgentProgress, SingleResult } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { UltraSessionRegistry } from "@oh-my-pi/pi-coding-agent/ultra/runtime";
import { TempDir } from "@oh-my-pi/pi-utils";

function createSession(
	options: { manager?: AsyncJobManager; owner?: string; activeModel?: string | (() => string) } = {},
): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings: Settings.isolated({}),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getAgentId: () => options.owner ?? "Main",
		getActiveModelString: () =>
			typeof options.activeModel === "function" ? options.activeModel() : (options.activeModel ?? "prov/main-model"),
		getForkableConversationSnapshot: () => ({
			messages: [],
			maxContextTokens: 100_000,
			contextWindow: 128_000,
		}),
		asyncJobManager: options.manager,
	} as unknown as ToolSession;
}

function makeResult(id: string, overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		index: 0,
		id,
		agent: "ultra",
		agentSource: "bundled",
		task: "prompt",
		exitCode: 0,
		output: "All done.",
		stderr: "",
		truncated: false,
		durationMs: 5,
		tokens: 0,
		requests: 1,
		...overrides,
	};
}

interface Deferred {
	promise: Promise<void>;
	resolve: () => void;
}

function deferred(): Deferred {
	const { promise, resolve } = Promise.withResolvers<void>();
	return { promise, resolve };
}

async function pollUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeoutMs) throw new Error("pollUntil timed out");
		await Bun.sleep(5);
	}
}

/**
 * Minimal stand-in for a worker AgentSession: records prompts/steers, replays
 * a scripted event stream through subscribed listeners on each prompt, and
 * reports a final assistant message — enough surface for the executor's run
 * monitor + driveSessionToYield.
 */
function createFakeWorkerSession(options: { streaming?: boolean } = {}) {
	const listeners = new Set<(event: unknown) => void>();
	const prompts: string[] = [];
	const steers: string[] = [];
	let disposed = false;
	let lastAssistant: { stopReason: string; content: Array<{ type: string; text: string }> } | undefined;
	let script: { events: unknown[]; responseText: string } | undefined;
	const fake = {
		isStreaming: options.streaming ?? false,
		model: undefined,
		subscribe(listener: (event: unknown) => void): () => void {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async prompt(text: string): Promise<boolean> {
			prompts.push(text);
			const active = script;
			script = undefined;
			if (active) {
				for (const event of active.events) {
					for (const listener of [...listeners]) listener(event);
				}
				lastAssistant = { stopReason: "stop", content: [{ type: "text", text: active.responseText }] };
				const end = { type: "message_end", message: { role: "assistant", content: lastAssistant.content } };
				for (const listener of [...listeners]) listener(end);
			}
			return true;
		},
		async steer(text: string): Promise<void> {
			steers.push(text);
		},
		async waitForIdle(): Promise<void> {},
		getLastAssistantMessage() {
			return lastAssistant;
		},
		async abort(): Promise<void> {},
		async dispose(): Promise<void> {
			disposed = true;
		},
	};
	return {
		session: fake as unknown as AgentSession,
		prompts,
		steers,
		isDisposed: () => disposed,
		setStreaming(value: boolean) {
			fake.isStreaming = value;
		},
		setScript(next: { events: unknown[]; responseText: string }) {
			script = next;
		},
	};
}

/** Scripted turn: one `read` tool call, then a successful `yield` carrying `data`. */
function yieldTurnEvents(data: unknown): unknown[] {
	return [
		{ type: "tool_execution_start", toolName: "read", args: { path: "src/foo.ts" }, intent: "Reading foo" },
		{ type: "tool_execution_end", toolName: "read", result: {}, isError: false },
		{ type: "tool_execution_start", toolName: "yield", args: {} },
		{
			type: "tool_execution_end",
			toolName: "yield",
			result: { details: { status: "success", data } },
			isError: false,
		},
	];
}

/** Progress snapshot in the shape the executor's run monitor emits. */
function progressSnapshot(id: string, overrides: Partial<AgentProgress> = {}): AgentProgress {
	return {
		index: 0,
		id,
		agent: "ultra",
		agentSource: "bundled",
		status: "running",
		task: "prompt",
		recentTools: [],
		recentOutput: [],
		toolCount: 0,
		requests: 0,
		tokens: 0,
		cost: 0,
		durationMs: 0,
		...overrides,
	};
}

let lifecycleEntrySequence = 0;

function lifecycleEntry(
	workerId: string,
	overrides: Partial<UltraWorkerLifecycleEntry> = {},
): UltraWorkerLifecycleEntry {
	lifecycleEntrySequence++;
	return {
		type: "ultra_worker_lifecycle",
		id: `lifecycle-${lifecycleEntrySequence}`,
		parentId: null,
		timestamp: new Date().toISOString(),
		workerId,
		action: "spawn",
		ownerId: "Main",
		modelOverride: "prov/main-model",
		...overrides,
	};
}

describe("ultra session registry", () => {
	const managers: AsyncJobManager[] = [];
	const sessionManagers: SessionManager[] = [];
	const tempDirs: TempDir[] = [];

	function createManager(): AsyncJobManager {
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		managers.push(manager);
		return manager;
	}

	function createTempDir(prefix: string): string {
		const dir = TempDir.createSync(prefix);
		tempDirs.push(dir);
		return dir.path();
	}

	async function createPersistedWorker(options: {
		cwd: string;
		sessionDir: string;
		workerKind?: "task" | "ultra";
		agentName?: string;
		agentId?: string;
	}): Promise<string> {
		const sessionManager = SessionManager.create(options.cwd, options.sessionDir);
		sessionManagers.push(sessionManager);
		sessionManager.appendSessionInit({
			systemPrompt: "persisted worker",
			task: "continue the workstream",
			tools: ["read", "edit", "yield"],
			spawns: "",
			workerKind: options.workerKind,
			agentName: options.agentName,
			agentId: options.agentId,
		});
		sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "persist this worker transcript" }],
			timestamp: Date.now(),
		});
		await sessionManager.ensureOnDisk();
		await sessionManager.flush();
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Expected a persisted worker session file");
		return sessionFile;
	}

	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
		UltraSessionRegistry.resetGlobalForTests();
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		for (const manager of managers.splice(0)) {
			await manager.dispose({ timeoutMs: 1000 });
		}
		await Promise.all(sessionManagers.splice(0).map(manager => manager.close()));
		await Promise.all(tempDirs.splice(0).map(dir => dir.remove()));
		UltraSessionRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("journals complete spawn metadata before launching the first turn", async () => {
		const root = createTempDir("@pi-ultra-spawn-lifecycle-");
		const ownerSessionFile = path.join(root, "owner.jsonl");
		const events: Array<Parameters<NonNullable<ToolSession["recordUltraWorkerLifecycle"]>>[0]> = [];
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				workerKind: "ultra",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "running",
			});
			AgentRegistry.global().setStatus(options.id, "idle");
			return makeResult(options.id);
		});

		const manager = createManager();
		const session = createSession({ manager });
		session.getSessionFile = () => ownerSessionFile;
		session.recordUltraWorkerLifecycle = event => events.push(event);
		const spawn = await UltraSessionRegistry.global().spawn(session, {
			name: "MetadataWorker",
			prompt: "Inspect metadata.",
		});

		expect(events[0]).toMatchObject({
			workerId: "MetadataWorker",
			action: "spawn",
			workerParentId: "Main",
			sessionFile: path.join(root, "owner", "MetadataWorker.jsonl"),
			modelOverride: "prov/main-model",
			turns: 0,
		});
		expect(events[0]?.createdAt).toEqual(expect.any(Number));
		await manager.getJob(spawn.jobId)!.promise;
	});

	it("derives parked screen state from the AgentRegistry", async () => {
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				workerKind: "ultra",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "idle",
			});
			return makeResult(options.id);
		});

		const manager = createManager();
		const registry = UltraSessionRegistry.global();
		const spawn = await registry.spawn(createSession({ manager }), { name: "Parkable", prompt: "Finish once." });
		await manager.getJob(spawn.jobId)!.promise;
		expect(registry.screens("Main")[0]?.state).toBe("idle");

		AgentRegistry.global().setStatus("Parkable", "parked");
		expect(registry.screens("Main")[0]?.state).toBe("parked");
	});

	it("restores a validated Ultra child session as a parked worker", async () => {
		const cwd = createTempDir("@pi-ultra-restore-workspace-");
		const ownerSessionFile = path.join(cwd, "owner.jsonl");
		const sessionFile = await createPersistedWorker({
			cwd,
			sessionDir: ownerSessionFile.slice(0, -6),
			workerKind: "ultra",
			agentName: "ultra",
			agentId: "Restored",
		});
		const registry = UltraSessionRegistry.global();
		const outcome = await registry.restorePersistedRoster(
			"Main",
			cwd,
			[
				lifecycleEntry("Restored", {
					workerParentId: "Main",
					sessionFile,
					createdAt: 123,
					turns: 4,
				}),
			],
			undefined,
			ownerSessionFile,
		);

		expect(outcome).toEqual({ restored: ["Restored"], skipped: [] });
		expect(AgentRegistry.global().get("Restored")).toMatchObject({
			id: "Restored",
			displayName: "ultra",
			kind: "sub",
			workerKind: "ultra",
			parentId: "Main",
			session: null,
			sessionFile,
			status: "parked",
		});
		expect(registry.screens("Main")).toEqual([
			expect.objectContaining({ id: "Restored", state: "parked", model: "prov/main-model", turns: 4 }),
		]);
	});

	it("revives the same cold-restored worker session when ultra_send starts its next explicit turn", async () => {
		const cwd = createTempDir("@pi-ultra-cold-send-");
		const ownerSessionFile = path.join(cwd, "owner.jsonl");
		const sessionFile = await createPersistedWorker({
			cwd,
			sessionDir: ownerSessionFile.slice(0, -6),
			workerKind: "ultra",
			agentName: "ultra",
			agentId: "ColdWorker",
		});
		const registry = UltraSessionRegistry.global();
		await registry.restorePersistedRoster(
			"Main",
			cwd,
			[lifecycleEntry("ColdWorker", { workerParentId: "Main", sessionFile, turns: 1 })],
			undefined,
			ownerSessionFile,
		);

		const fake = createFakeWorkerSession();
		fake.setScript({ events: yieldTurnEvents({ report: "continued after restart" }), responseText: "resumed" });
		let factoryCalls = 0;
		AgentLifecycleManager.global().setPersistedSubagentReviverFactory(async ref => {
			factoryCalls++;
			expect(ref.sessionFile).toBe(sessionFile);
			return async () => fake.session;
		}, 0);

		const manager = createManager();
		const outcome = await registry.send(createSession({ manager }), {
			session: "ColdWorker",
			message: "Continue explicitly; do not replay the interrupted turn.",
		});
		expect(outcome.mode).toBe("turn");
		await manager.getJob(outcome.jobId!)!.promise;

		expect(factoryCalls).toBe(1);
		expect(fake.prompts).toEqual(["Continue explicitly; do not replay the interrupted turn."]);
		expect(AgentRegistry.global().get("ColdWorker")?.sessionFile).toBe(sessionFile);
		expect(registry.screens("Main")[0]).toMatchObject({ id: "ColdWorker", state: "idle", turns: 2 });
	});

	it("skips invalid, missing, non-Ultra, cross-workspace, and out-of-artifact roster files", async () => {
		const cwd = createTempDir("@pi-ultra-restore-validation-");
		const otherCwd = createTempDir("@pi-ultra-restore-other-workspace-");
		const ownerSessionFile = path.join(cwd, "owner.jsonl");
		const artifactDir = ownerSessionFile.slice(0, -6);
		const nonUltraFile = await createPersistedWorker({
			cwd,
			sessionDir: artifactDir,
			workerKind: "task",
			agentName: "sonic",
			agentId: "TaskFile",
		});
		const crossWorkspaceFile = await createPersistedWorker({
			cwd: otherCwd,
			sessionDir: artifactDir,
			workerKind: "ultra",
			agentName: "ultra",
			agentId: "OtherWorkspace",
		});
		const outsideFile = await createPersistedWorker({
			cwd,
			sessionDir: path.join(cwd, "unrelated-artifacts"),
			workerKind: "ultra",
			agentName: "ultra",
			agentId: "OutsideArtifacts",
		});
		const substitutedFile = await createPersistedWorker({
			cwd,
			sessionDir: artifactDir,
			workerKind: "ultra",
			agentName: "ultra",
			agentId: "ActualWorker",
		});
		const symlinkFile = path.join(artifactDir, "SymlinkEscape.jsonl");
		await fs.symlink(outsideFile, symlinkFile);
		const invalidFile = path.join(artifactDir, "invalid.jsonl");
		await Bun.write(invalidFile, "{not-valid-jsonl\n");
		const entries = [
			lifecycleEntry("Incomplete", { sessionFile: undefined }),
			lifecycleEntry("Missing", { sessionFile: path.join(artifactDir, "missing.jsonl") }),
			lifecycleEntry("InvalidFile", { sessionFile: invalidFile }),
			lifecycleEntry("TaskFile", { sessionFile: nonUltraFile }),
			lifecycleEntry("OtherWorkspace", { sessionFile: crossWorkspaceFile }),
			lifecycleEntry("OutsideArtifacts", { sessionFile: outsideFile }),
			lifecycleEntry("Substituted", { sessionFile: substitutedFile }),
			lifecycleEntry("SymlinkEscape", { sessionFile: symlinkFile }),
		];

		const outcome = await UltraSessionRegistry.global().restorePersistedRoster(
			"Main",
			cwd,
			entries,
			undefined,
			ownerSessionFile,
		);

		expect(outcome.restored).toEqual([]);
		expect(outcome.skipped.map(issue => issue.workerId)).toEqual([
			"Incomplete",
			"Missing",
			"InvalidFile",
			"TaskFile",
			"OtherWorkspace",
			"OutsideArtifacts",
			"Substituted",
			"SymlinkEscape",
		]);
		expect(outcome.skipped.map(issue => issue.reason).join("\n")).toContain("metadata is incomplete");
		expect(outcome.skipped.map(issue => issue.reason).join("\n")).toContain("unavailable");
		expect(outcome.skipped.map(issue => issue.reason).join("\n")).toContain("session-init contract");
		expect(outcome.skipped.map(issue => issue.reason).join("\n")).toContain("different workspace");
		expect(outcome.skipped.map(issue => issue.reason).join("\n")).toContain("outside the owning transcript");
		expect(outcome.skipped.map(issue => issue.reason).join("\n")).toContain("different worker id");
		expect(AgentRegistry.global().list()).toEqual([]);
	});

	it("rejects malformed and forward lifecycle records without invoking path or string operations on them", async () => {
		const cwd = createTempDir("@pi-ultra-restore-malformed-");
		const ownerSessionFile = path.join(cwd, "owner.jsonl");
		const entries = [
			lifecycleEntry("FutureAction", {
				action: "hibernate" as never,
				sessionFile: path.join(ownerSessionFile.slice(0, -6), "FutureAction.jsonl"),
			}),
			lifecycleEntry("BadPath", { sessionFile: 42 as never }),
			lifecycleEntry(42 as never, {
				sessionFile: path.join(ownerSessionFile.slice(0, -6), "NumberId.jsonl"),
			}),
			null as unknown as UltraWorkerLifecycleEntry,
		];

		const outcome = await UltraSessionRegistry.global().restorePersistedRoster(
			"Main",
			cwd,
			entries,
			undefined,
			ownerSessionFile,
		);

		expect(outcome).toEqual({
			restored: [],
			skipped: [
				{ workerId: "FutureAction", reason: "persisted roster metadata is incomplete" },
				{ workerId: "BadPath", reason: "persisted roster metadata is incomplete" },
				{ workerId: "<invalid>", reason: "persisted roster metadata is incomplete" },
				{ workerId: "<invalid>", reason: "persisted roster metadata is incomplete" },
			],
		});
		expect(AgentRegistry.global().list()).toEqual([]);
	});

	it("does not overwrite an active Task worker whose id collides with a persisted Ultra worker", async () => {
		const cwd = createTempDir("@pi-ultra-restore-collision-");
		const ownerSessionFile = path.join(cwd, "owner.jsonl");
		const sessionFile = await createPersistedWorker({
			cwd,
			sessionDir: ownerSessionFile.slice(0, -6),
			workerKind: "ultra",
			agentName: "ultra",
			agentId: "Collision",
		});
		const taskSession = createFakeWorkerSession().session;
		const existing = AgentRegistry.global().register({
			id: "Collision",
			displayName: "sonic",
			kind: "sub",
			workerKind: "task",
			parentId: "Main",
			session: taskSession,
			sessionFile: path.join(cwd, "task-collision.jsonl"),
			status: "running",
		});

		const outcome = await UltraSessionRegistry.global().restorePersistedRoster(
			"Main",
			cwd,
			[lifecycleEntry("Collision", { workerParentId: "Main", sessionFile })],
			undefined,
			ownerSessionFile,
		);

		expect(outcome.restored).toEqual([]);
		expect(outcome.skipped).toEqual([
			{ workerId: "Collision", reason: "worker id conflicts with an existing agent registration" },
		]);
		expect(AgentRegistry.global().get("Collision")).toBe(existing);
		expect(AgentRegistry.global().get("Collision")).toMatchObject({
			displayName: "sonic",
			workerKind: "task",
			status: "running",
			session: taskSession,
		});
		expect(UltraSessionRegistry.global().listIds("Main")).toEqual([]);
	});

	it("records an explicit kill before cancelling its in-flight job", async () => {
		const gate = deferred();
		const order: string[] = [];
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				workerKind: "ultra",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "running",
			});
			await gate.promise;
			return makeResult(options.id);
		});
		const manager = createManager();
		const originalCancel = manager.cancel.bind(manager);
		vi.spyOn(manager, "cancel").mockImplementation((jobId, options) => {
			order.push("cancel");
			return originalCancel(jobId, options);
		});
		const session = createSession({ manager });
		session.recordUltraWorkerLifecycle = event => {
			if (event.action === "kill") order.push("kill-marker");
		};
		const registry = UltraSessionRegistry.global();
		await registry.spawn(session, { name: "KilledInFlight", prompt: "Wait." });
		await pollUntil(() => AgentRegistry.global().get("KilledInFlight") !== undefined);

		await registry.kill(session, "KilledInFlight");
		expect(order.slice(0, 2)).toEqual(["kill-marker", "cancel"]);
		gate.resolve();
	});

	it("cannot re-journal a killed parent while descendant teardown is pending", async () => {
		const parentGate = deferred();
		const childGate = deferred();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				workerKind: "ultra",
				parentId: options.parentAgentId,
				session: createFakeWorkerSession().session,
				status: "running",
			});
			await (options.id === "Parent" ? parentGate.promise : childGate.promise);
			AgentRegistry.global().setStatus(options.id, "idle");
			return makeResult(options.id);
		});

		const manager = createManager();
		const lifecycle = SessionManager.inMemory(createTempDir("@pi-ultra-descendant-kill-journal-"));
		const parentSession = createSession({ manager, owner: "Main" });
		parentSession.recordUltraWorkerLifecycle = event =>
			lifecycle.appendUltraWorkerLifecycle({ ...event, ownerId: "Main" });
		const childSession = createSession({ manager, owner: "Parent" });
		childSession.recordUltraWorkerLifecycle = event =>
			lifecycle.appendUltraWorkerLifecycle({ ...event, ownerId: "Parent" });

		const registry = UltraSessionRegistry.global();
		const parent = await registry.spawn(parentSession, { name: "Parent", prompt: "Coordinate." });
		const child = await registry.spawn(childSession, { name: "Child", prompt: "Work." });
		await pollUntil(
			() => AgentRegistry.global().get("Parent") !== undefined && AgentRegistry.global().get("Child") !== undefined,
		);

		const childReleaseStarted = deferred();
		const continueChildRelease = deferred();
		const lifecycleManager = AgentLifecycleManager.global();
		const originalRelease = lifecycleManager.release.bind(lifecycleManager);
		vi.spyOn(lifecycleManager, "release").mockImplementation(async (id, options) => {
			if (id === "Child") {
				childReleaseStarted.resolve();
				await continueChildRelease.promise;
			}
			await originalRelease(id, options);
		});

		const killPromise = registry.kill(parentSession, "Parent");
		await childReleaseStarted.promise;

		// A cancelled callback can still return while kill awaits the child. The
		// parent's terminal fence must make #finishTurn a no-op for the journal.
		parentGate.resolve();
		await manager.getJob(parent.jobId)!.promise;
		const parentRosterDuringDescendantTeardown = lifecycle
			.getActiveUltraWorkerRoster("Main")
			.map(entry => entry.workerId);

		continueChildRelease.resolve();
		await killPromise;
		childGate.resolve();
		await manager.getJob(child.jobId)!.promise;

		expect(parentRosterDuringDescendantTeardown).toEqual([]);
		expect(lifecycle.getActiveUltraWorkerRoster("Main")).toEqual([]);
	});

	it("preserves the active lifecycle journal while forgetting all live runtime state", async () => {
		const gate = deferred();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				workerKind: "ultra",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "running",
			});
			await gate.promise;
			return makeResult(options.id);
		});
		const manager = createManager();
		const lifecycle = SessionManager.inMemory(createTempDir("@pi-ultra-preserve-journal-"));
		const session = createSession({ manager });
		session.recordUltraWorkerLifecycle = event => lifecycle.appendUltraWorkerLifecycle({ ...event, ownerId: "Main" });
		const registry = UltraSessionRegistry.global();
		const spawn = await registry.spawn(session, { name: "Preserved", prompt: "Keep this roster." });
		await pollUntil(() => AgentRegistry.global().get("Preserved") !== undefined);

		const preserved = await registry.preserveAll("Main", manager, "shutdown");
		expect(preserved).toBe(1);
		expect(lifecycle.getActiveUltraWorkerRoster("Main").map(entry => entry.workerId)).toEqual(["Preserved"]);
		expect(registry.listIds("Main")).toEqual([]);
		expect(registry.screens("Main")).toEqual([]);
		expect(AgentRegistry.global().get("Preserved")).toBeUndefined();
		expect(manager.getJob(spawn.jobId)?.status).toBe("cancelled");

		gate.resolve();
		await manager.getJob(spawn.jobId)?.promise;
		expect(lifecycle.getActiveUltraWorkerRoster("Main").map(entry => entry.workerId)).toEqual(["Preserved"]);
	});

	it("spawn returns immediately and self-delivers a turn result with activity trace + response", async () => {
		const gate = deferred();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			expect(options.agent.name).toBe("ultra");
			expect(options.agent.model).toBeUndefined();
			expect(options.agent.thinkingLevel).toBe(ThinkingLevel.XHigh);
			expect(options.agent.spawns).toBeUndefined();
			expect(options.modelOverride).toBe("prov/main-model");
			expect(options.parentActiveModelPattern).toBe("prov/main-model");
			expect(options.thinkingLevel).toBe(ThinkingLevel.XHigh);
			expect(options.ultraWorker).toBe(true);
			expect(options.context).toContain("parent request for the widget");
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "running",
			});
			options.onProgress?.(
				progressSnapshot(options.id, {
					toolCount: 2,
					recentTools: [
						{ tool: "bash", args: "bun test", endMs: 2 },
						{ tool: "read", args: "src/foo.ts", endMs: 1 },
					],
					lastIntent: "Running tests",
					resolvedModel: "prov/main-model",
				}),
			);
			await gate.promise;
			AgentRegistry.global().setStatus(options.id, "idle");
			return makeResult(options.id, { output: "Implemented the widget.", requests: 3 });
		});

		const manager = createManager();
		const session = createSession({ manager });
		session.getForkableConversationSnapshot = () => ({
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: "parent request for the widget" }],
					timestamp: Date.now(),
				},
			],
			maxContextTokens: 100_000,
			contextWindow: 128_000,
		});
		const registry = UltraSessionRegistry.global();

		const { id, jobId } = await registry.spawn(session, { name: "Builder", prompt: "Build the widget." });
		expect(id).toBe("Builder");

		// Ack is immediate: the job is still running behind the gate.
		const job = manager.getJob(jobId)!;
		expect(job.status).toBe("running");
		expect(registry.screens("Main")[0]?.id).toBe("Builder");

		gate.resolve();
		await job.promise;

		expect(job.status).toBe("completed");
		const text = job.resultText ?? "";
		// Envelope + summarized activity (compressed tool trace, oldest first) + response.
		expect(text).toContain('<ultra-turn session="Builder" turn="1" status="completed"');
		expect(text).toContain('model="prov/main-model"');
		expect(text.indexOf("read(src/foo.ts)")).toBeGreaterThan(-1);
		expect(text.indexOf("read(src/foo.ts)")).toBeLessThan(text.indexOf("bash(bun test)"));
		expect(text).toContain("Implemented the widget.");
		// Session survives the turn, addressable for follow-ups.
		const entry = registry.screens("Main")[0]!;
		expect(entry.state).toBe("idle");
		expect(entry.turns).toBe(1);
	});

	it("pins recursive descendants to their root worker model after the main session switches", async () => {
		const gates = new Map<string, Deferred>();
		const launches = new Map<string, Parameters<typeof executorModule.runSubprocess>[0]>();
		const workerSessions = new Map<string, ToolSession>();
		const manager = createManager();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			launches.set(options.id, options);
			const modelOverride = options.modelOverride;
			if (typeof modelOverride !== "string") {
				throw new Error("Ultra workers must receive one pinned model selector");
			}
			const workerSession = createSession({
				manager,
				owner: options.id,
				activeModel: modelOverride,
			});
			workerSessions.set(options.id, workerSession);
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: options.parentAgentId ?? "Main",
				session: workerSession as unknown as AgentSession,
				status: "running",
			});
			const gate = deferred();
			gates.set(options.id, gate);
			await gate.promise;
			AgentRegistry.global().setStatus(options.id, "idle");
			return makeResult(options.id, { resolvedModel: modelOverride });
		});

		let mainModel = "prov/root-pinned-model";
		const mainSession = createSession({ manager, activeModel: () => mainModel });
		const registry = UltraSessionRegistry.global();
		const root = await registry.spawn(mainSession, { name: "Root", prompt: "Start the root workstream." });
		await pollUntil(() => workerSessions.has("Root"));
		expect(launches.get("Root")?.modelOverride).toBe("prov/root-pinned-model");

		mainModel = "prov/main-later-model";
		const nested = await registry.spawn(workerSessions.get("Root")!, {
			name: "Nested",
			prompt: "Handle the nested workstream.",
		});
		await pollUntil(() => launches.has("Nested"));

		expect(launches.get("Nested")?.modelOverride).toBe("prov/root-pinned-model");
		expect(launches.get("Nested")?.parentActiveModelPattern).toBe("prov/root-pinned-model");
		expect(launches.get("Nested")?.modelOverride).not.toBe(mainModel);

		for (const gate of gates.values()) gate.resolve();
		await Promise.all([manager.getJob(root.jobId)!.promise, manager.getJob(nested.jobId)!.promise]);
	});

	it("snapshots the current main model independently for each direct worker", async () => {
		const launches = new Map<string, { modelOverride: string | undefined; parentModel: string | undefined }>();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			const modelOverride = options.modelOverride;
			if (typeof modelOverride !== "string") {
				throw new Error("Ultra workers must receive one pinned model selector");
			}
			launches.set(options.id, {
				modelOverride,
				parentModel: options.parentActiveModelPattern,
			});
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "running",
			});
			options.onProgress?.(progressSnapshot(options.id, { resolvedModel: modelOverride }));
			AgentRegistry.global().setStatus(options.id, "idle");
			return makeResult(options.id, { resolvedModel: modelOverride });
		});

		const manager = createManager();
		let mainModel = "prov/model-a";
		const mainSession = createSession({ manager, activeModel: () => mainModel });
		const registry = UltraSessionRegistry.global();

		const workerA = await registry.spawn(mainSession, { name: "WorkerA", prompt: "Work on A." });
		mainModel = "prov/model-b";
		const workerB = await registry.spawn(mainSession, { name: "WorkerB", prompt: "Work on B." });
		await Promise.all([manager.getJob(workerA.jobId)!.promise, manager.getJob(workerB.jobId)!.promise]);

		expect(launches.get("WorkerA")).toEqual({
			modelOverride: "prov/model-a",
			parentModel: "prov/model-a",
		});
		expect(launches.get("WorkerB")).toEqual({
			modelOverride: "prov/model-b",
			parentModel: "prov/model-b",
		});
		expect(registry.screens("Main").map(({ id, model }) => ({ id, model }))).toEqual([
			{ id: "WorkerA", model: "prov/model-a" },
			{ id: "WorkerB", model: "prov/model-b" },
		]);
	});

	it("send steers a streaming mid-turn worker and queues for a non-steerable one", async () => {
		const gate = deferred();
		const fake = createFakeWorkerSession({ streaming: true });
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: "Main",
				session: fake.session,
				status: "running",
			});
			await gate.promise;
			AgentRegistry.global().setStatus(options.id, "idle");
			return makeResult(options.id);
		});
		const followUps: Array<{ id: string; message: string }> = [];
		vi.spyOn(executorModule, "runSubagentFollowUpTurn").mockImplementation(async options => {
			followUps.push({ id: options.id, message: options.message });
			return makeResult(options.id, { output: "queued work done" });
		});

		const manager = createManager();
		const session = createSession({ manager });
		const registry = UltraSessionRegistry.global();
		const { jobId } = await registry.spawn(session, { name: "Designer", prompt: "Design it." });
		await pollUntil(() => AgentRegistry.global().get("Designer") !== undefined);

		// Streaming worker → steering.
		const steered = await registry.send(session, { session: "Designer", message: "Focus on the API first." });
		expect(steered.mode).toBe("steered");
		expect(fake.steers).toEqual(["Focus on the API first."]);

		// Not streaming → queued for the next turn.
		fake.setStreaming(false);
		const queued = await registry.send(session, { session: "Designer", message: "Then write tests." });
		expect(queued.mode).toBe("queued");
		expect(registry.screens("Main")[0]?.queued).toBe(1);

		// Settling the turn drains the queue into an automatic follow-up turn.
		gate.resolve();
		await manager.getJob(jobId)!.promise;
		await pollUntil(() => followUps.length === 1);
		expect(followUps[0]).toEqual({ id: "Designer", message: "Then write tests." });
	});

	it("send to an idle session starts a follow-up turn on the same worker", async () => {
		const gate = deferred();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "running",
			});
			await gate.promise;
			AgentRegistry.global().setStatus(options.id, "idle");
			return makeResult(options.id);
		});
		const followUps: Array<{ id: string; message: string }> = [];
		vi.spyOn(executorModule, "runSubagentFollowUpTurn").mockImplementation(async options => {
			followUps.push({ id: options.id, message: options.message });
			options.onProgress?.(
				progressSnapshot(options.id, {
					toolCount: 1,
					recentTools: [{ tool: "edit", args: "src/foo.ts", endMs: 1 }],
				}),
			);
			return makeResult(options.id, { output: "Renamed everything." });
		});

		const manager = createManager();
		const session = createSession({ manager });
		const registry = UltraSessionRegistry.global();
		const spawn = await registry.spawn(session, { name: "Worker", prompt: "First task." });
		gate.resolve();
		await manager.getJob(spawn.jobId)!.promise;

		const outcome = await registry.send(session, { session: "Worker", message: "Now rename the helpers." });
		expect(outcome.mode).toBe("turn");
		const turnJob = manager.getJob(outcome.jobId!)!;
		await turnJob.promise;

		expect(followUps).toEqual([{ id: "Worker", message: "Now rename the helpers." }]);
		const text = turnJob.resultText ?? "";
		expect(text).toContain('turn="2"');
		expect(text).toContain("edit(src/foo.ts)");
		expect(text).toContain("Renamed everything.");
		expect(registry.screens("Main")[0]?.turns).toBe(2);
	});

	it("runSubagentFollowUpTurn continues the same live session and finalizes trace + yield response", async () => {
		const fake = createFakeWorkerSession();
		AgentRegistry.global().register({
			id: "Worker",
			displayName: "Worker",
			kind: "sub",
			parentId: "Main",
			session: fake.session,
			status: "idle",
		});
		const agent: AgentDefinition = {
			name: "ultra",
			description: "worker",
			systemPrompt: "sp",
			source: "bundled",
			thinkingLevel: ThinkingLevel.XHigh,
		};

		fake.setScript({ events: yieldTurnEvents({ report: "did the first thing" }), responseText: "first summary" });
		const progressSnapshots: AgentProgress[] = [];
		const first = await executorModule.runSubagentFollowUpTurn({
			id: "Worker",
			agent,
			message: "do the first thing",
			onProgress: progress => progressSnapshots.push({ ...progress, recentTools: progress.recentTools.slice() }),
		});
		expect(first.exitCode).toBe(0);
		expect(first.output).toContain("did the first thing");
		expect(progressSnapshots.some(progress => progress.recentTools.some(entry => entry.tool === "read"))).toBe(true);

		// Second turn lands on the SAME session instance — prior context retained.
		fake.setScript({ events: yieldTurnEvents({ report: "built on prior work" }), responseText: "second summary" });
		const second = await executorModule.runSubagentFollowUpTurn({ id: "Worker", agent, message: "now extend it" });
		expect(second.exitCode).toBe(0);
		expect(second.output).toContain("built on prior work");
		expect(fake.prompts).toEqual(["do the first thing", "now extend it"]);
		expect(fake.isDisposed()).toBe(false);
	});

	it("wait wakes on the first settling turn among concurrent sessions and suppresses its re-delivery", async () => {
		const gates = new Map<string, Deferred>();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "running",
			});
			const gate = deferred();
			gates.set(options.id, gate);
			await gate.promise;
			AgentRegistry.global().setStatus(options.id, "idle");
			return makeResult(options.id, { output: `${options.id} finished.` });
		});

		const manager = createManager();
		const session = createSession({ manager });
		const registry = UltraSessionRegistry.global();
		const first = await registry.spawn(session, { name: "Alpha", prompt: "Task A." });
		const second = await registry.spawn(session, { name: "Beta", prompt: "Task B." });
		await pollUntil(() => gates.size === 2);

		const waitPromise = registry.wait(session, { sessions: ["Alpha", "Beta"], timeoutMs: 5000 });
		gates.get("Alpha")!.resolve();
		const outcome = await waitPromise;

		expect(outcome.timedOut).toBe(false);
		expect(outcome.settled.map(entry => entry.id)).toEqual(["Alpha"]);
		expect(outcome.settled[0]!.resultText).toContain("Alpha finished.");
		expect(outcome.stillRunning).toEqual(["Beta"]);
		// The reported result must not be delivered a second time as a follow-up.
		expect(manager.isDeliverySuppressed(first.jobId)).toBe(true);
		expect(manager.isDeliverySuppressed(second.jobId)).toBe(false);

		gates.get("Beta")!.resolve();
		await manager.getJob(second.jobId)!.promise;
	});

	it("wait reports the settled turn even when a queued follow-up starts immediately", async () => {
		const firstGate = deferred();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "running",
			});
			await firstGate.promise;
			AgentRegistry.global().setStatus(options.id, "idle");
			return makeResult(options.id, { output: "First turn done." });
		});
		const followUpGate = deferred();
		vi.spyOn(executorModule, "runSubagentFollowUpTurn").mockImplementation(async options => {
			await followUpGate.promise;
			return makeResult(options.id, { output: "Follow-up done." });
		});

		const manager = createManager();
		const session = createSession({ manager });
		const registry = UltraSessionRegistry.global();
		const { jobId } = await registry.spawn(session, { name: "Worker", prompt: "Task A." });
		await pollUntil(() => AgentRegistry.global().get("Worker") !== undefined);

		// Queued while mid-turn: #finishTurn starts this follow-up turn inside
		// the settling job's callback, BEFORE the watched job's promise resolves.
		const queued = await registry.send(session, { session: "Worker", message: "Task B." });
		expect(queued.mode).toBe("queued");

		const waitPromise = registry.wait(session, { sessions: ["Worker"], timeoutMs: 5000 });
		firstGate.resolve();
		const outcome = await waitPromise;

		// The settled first turn is reported (not shadowed by the new in-flight
		// turn) and acknowledged so it is not re-delivered …
		expect(outcome.settled.map(entry => entry.jobId)).toEqual([jobId]);
		expect(outcome.settled[0]!.resultText).toContain("First turn done.");
		expect(manager.isDeliverySuppressed(jobId)).toBe(true);
		// … while the drained-queue follow-up shows as still running.
		expect(outcome.stillRunning).toEqual(["Worker"]);

		followUpGate.resolve();
		await manager.getJob("Worker-t2")!.promise;
	});

	it("kill cancels the in-flight turn and releases the worker session", async () => {
		const gate = deferred();
		const fake = createFakeWorkerSession();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: "Main",
				session: fake.session,
				status: "running",
			});
			await gate.promise;
			return makeResult(options.id);
		});

		const manager = createManager();
		const session = createSession({ manager });
		const registry = UltraSessionRegistry.global();
		const { jobId } = await registry.spawn(session, { name: "Doomed", prompt: "Never mind." });
		await pollUntil(() => AgentRegistry.global().get("Doomed") !== undefined);

		const outcome = await registry.kill(session, "Doomed");
		expect(outcome.cancelledTurn).toBe(true);
		expect(manager.getJob(jobId)!.status).toBe("cancelled");
		expect(fake.isDisposed()).toBe(true);
		expect(AgentRegistry.global().get("Doomed")).toBeUndefined();
		expect(registry.screens("Main")[0]?.state).toBe("dead");
		await expect(registry.send(session, { session: "Doomed", message: "hello?" })).rejects.toThrow("dead");

		gate.resolve();
	});

	it("keeps sessions isolated by owner", async () => {
		const gate = deferred();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "running",
			});
			await gate.promise;
			return makeResult(options.id);
		});

		const manager = createManager();
		const ownerSession = createSession({ manager, owner: "Main" });
		const otherSession = createSession({ manager, owner: "Other" });
		const registry = UltraSessionRegistry.global();
		await registry.spawn(ownerSession, { name: "Owned", prompt: "Private work." });
		await pollUntil(() => AgentRegistry.global().get("Owned") !== undefined);

		expect(registry.listIds("Other")).toEqual([]);
		expect(registry.screens("Other")).toEqual([]);
		await expect(registry.send(otherSession, { session: "Owned", message: "intrude" })).rejects.toThrow(
			/Unknown ultra session/u,
		);
		await expect(registry.kill(otherSession, "Owned")).rejects.toThrow(/Unknown ultra session/u);
		expect(registry.listIds("Main")).toEqual(["Owned"]);

		await registry.kill(ownerSession, "Owned");
		gate.resolve();
	});

	it("killAll terminates every session for the owner (mode-exit path)", async () => {
		const gates = new Map<string, Deferred>();
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			AgentRegistry.global().register({
				id: options.id,
				displayName: options.id,
				kind: "sub",
				parentId: "Main",
				session: createFakeWorkerSession().session,
				status: "running",
			});
			const gate = deferred();
			gates.set(options.id, gate);
			await gate.promise;
			return makeResult(options.id);
		});

		const manager = createManager();
		const session = createSession({ manager });
		const registry = UltraSessionRegistry.global();
		await registry.spawn(session, { name: "One", prompt: "A." });
		await registry.spawn(session, { name: "Two", prompt: "B." });
		await pollUntil(() => gates.size === 2);

		const killed = await registry.killAll("Main", manager);
		expect(killed).toBe(2);
		expect(registry.listIds("Main")).toEqual([]);
		expect(AgentRegistry.global().get("One")).toBeUndefined();
		expect(AgentRegistry.global().get("Two")).toBeUndefined();

		for (const gate of gates.values()) gate.resolve();
	});
});
