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
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import * as executorModule from "@oh-my-pi/pi-coding-agent/task/executor";
import type { AgentDefinition, AgentProgress, SingleResult } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { UltraSessionRegistry } from "@oh-my-pi/pi-coding-agent/ultra/runtime";

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

describe("ultra session registry", () => {
	const managers: AsyncJobManager[] = [];

	function createManager(): AsyncJobManager {
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		managers.push(manager);
		return manager;
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
		UltraSessionRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
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
