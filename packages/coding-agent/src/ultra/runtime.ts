/**
 * Ultra worker-session runtime.
 *
 * Owns the persistent, addressable worker sessions the Ultra main agent drives.
 * Each worker is a real task-executor subagent with full tool access:
 * spawned once through {@link runSubprocess} (keep-alive), continued
 * turn-by-turn through {@link runSubagentFollowUpTurn}. Between turns the
 * worker lives in the AgentRegistry / AgentLifecycleManager as an adopted idle
 * agent (TTL park + JSONL revive), so its conversation context survives across
 * turns and even across parking.
 *
 * Every turn runs as an AsyncJobManager job, so a completed turn self-delivers
 * into the director's conversation exactly like an async `task` result, and
 * `ultra_wait` can block on the first settling turn with `hub`-wait semantics.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { logger, prompt, Snowflake } from "@oh-my-pi/pi-utils";
import { type AsyncJob, AsyncJobManager } from "../async/job-manager";
import { formatModelStringWithRouting } from "../config/model-resolver";
import type { LocalProtocolOptions } from "../internal-urls";
import { registerArtifactsDir } from "../internal-urls/registry-helpers";
import { MCPManager } from "../mcp/manager";
import ultraWorkerPrompt from "../prompts/agents/ultra-worker.md" with { type: "text" };
import ultraTurnResultTemplate from "../prompts/tools/ultra-turn-result.md" with { type: "text" };
import { AgentLifecycleManager } from "../registry/agent-lifecycle";
import { AgentRegistry, MAIN_AGENT_ID } from "../registry/agent-registry";
import type { UltraWorkerLifecycleEntry } from "../session/session-entries";
import { SessionManager } from "../session/session-manager";
import { getBundledAgent } from "../task/agents";
import { type ExecutorOptions, runSubagentFollowUpTurn, runSubprocess } from "../task/executor";
import { generateTaskName } from "../task/name-generator";
import { AgentOutputManager } from "../task/output-manager";
import { type AgentDefinition, type AgentProgress, oneLineLabel, type SingleResult } from "../task/types";
import type { ToolSession } from "../tools";
import { formatDuration } from "../tools/render-utils";
import { ToolError } from "../tools/tool-errors";
import { calculateTokensPerSecond } from "../utils/token-rate";
import { buildUltraForkContext, parseUltraForkTurns } from "./context";

/**
 * Build the private Ultra worker definition from the general task prompt.
 * The clone is never added to ordinary agent discovery: Ultra owns its public
 * spawn surface, exact model, reasoning policy, and recursive orchestration.
 */
function createUltraWorkerAgent(): AgentDefinition {
	const taskAgent = getBundledAgent("task");
	if (!taskAgent) throw new ToolError('Bundled agent "task" is unavailable for Ultra workers.');
	return {
		...taskAgent,
		name: "ultra",
		description: "Generic fully capable Ultra worker",
		systemPrompt: prompt.render(ultraWorkerPrompt),
		model: undefined,
		thinkingLevel: ThinkingLevel.XHigh,
		spawns: undefined,
	};
}

/** Worker session lifecycle as shown to the director. */
export type UltraSessionState = "starting" | "running" | "idle" | "parked" | "dead";

/** One completed tool call in the per-turn activity trace. */
interface UltraTraceEntry {
	tool: string;
	args: string;
	endMs: number;
}

/** Cap on trace entries retained per turn (the run monitor keeps 5; we widen the window). */
const TURN_TRACE_CAP = 40;
/** Cap on a single rendered trace line. */
const TRACE_LINE_MAX = 120;
/** Default `ultra_wait` window when no timeout was given (ms). */
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
/** Response text cap inside a delivered turn result; full output stays at agent://<id>. */
const RESPONSE_PREVIEW_MAX = 6000;

interface UltraTurn {
	jobId: string;
	message: string;
	startedAt: number;
	/** Trace of tool calls completed during this turn, oldest first. */
	trace: UltraTraceEntry[];
	/** Total completed tool calls (trace may be narrower than this). */
	toolCount: number;
}

interface UltraRecord {
	id: string;
	ownerId: string;
	parentId: string;
	agent: AgentDefinition;
	modelOverride: string;
	/** Exact child JSONL contract when the owning conversation is persisted. */
	sessionFile?: string;
	/** Writes lifecycle state into the owning session, retained for nested cascades. */
	recordLifecycle?: UltraLifecycleRecorder;
	/** Parent conversation snapshot rendered once into the worker's system context. */
	inheritedContext?: string;
	state: UltraSessionState;
	createdAt: number;
	lastActivityAt: number;
	/** One-line gist of the latest activity (intent, tool, or result preview). */
	lastActivity?: string;
	/** Resolved model display string once known. */
	resolvedModel?: string;
	turn?: UltraTurn;
	/** Live view of the in-flight turn (current tool, intent, streamed text tail). */
	live?: {
		currentTool?: string;
		currentToolArgs?: string;
		lastIntent?: string;
		/** Latest streamed assistant text lines, oldest first. */
		outputTail: string[];
	};
	/** Job id of the most recently settled turn (wait snapshots after settle). */
	lastJobId?: string;
	/** Messages queued while a turn was in flight; drained into the next turn. */
	queue: string[];
	turnCount: number;
	killed: boolean;
	/** Prevent duplicate terminal lifecycle markers across failure/kill races. */
	lifecycleClosed?: boolean;
}

export interface UltraRosterRestoreIssue {
	workerId: string;
	reason: string;
}

export interface UltraRosterRestoreOutcome {
	restored: string[];
	skipped: UltraRosterRestoreIssue[];
}

type UltraLifecycleEvent = Parameters<NonNullable<ToolSession["recordUltraWorkerLifecycle"]>>[0];
type UltraLifecycleRecorder = (event: UltraLifecycleEvent) => void;

/**
 * Live per-session "screen" for rich rendering: what the worker is doing right
 * now (tool trace, current tool, streamed text tail) plus roster metadata.
 * Every string is already one-line sanitized.
 */
export interface UltraScreenSnapshot {
	id: string;
	state: UltraSessionState;
	model?: string;
	turns: number;
	queued: number;
	/** Start of the in-flight turn, when running. */
	turnStartedAt?: number;
	/** Gist of the message that started the in-flight turn. */
	turnMessage?: string;
	currentTool?: string;
	currentToolArgs?: string;
	lastIntent?: string;
	/** Completed tool calls of the in-flight turn, oldest first (tail). */
	trace: string[];
	/** Latest streamed worker text lines, oldest first. */
	outputTail: string[];
	lastActivity?: string;
	lastActivityAt: number;
}

export interface UltraSpawnOutcome {
	id: string;
	jobId: string;
}

export interface UltraSendOutcome {
	id: string;
	/**
	 * - `turn`: a new background turn was started (`jobId` set).
	 * - `steered`: worker was mid-turn and streaming; delivered as steering.
	 * - `queued`: worker was mid-turn but not steerable; drained into the next turn.
	 */
	mode: "turn" | "steered" | "queued";
	jobId?: string;
}

export interface UltraKillOutcome {
	id: string;
	/** True when an in-flight turn job was cancelled along the way. */
	cancelledTurn: boolean;
}

export interface UltraWaitOutcome {
	/** Watched sessions whose snapshotted turn settled during (or before) the wait.
	 * May overlap `stillRunning` when a queued follow-up turn already started. */
	settled: Array<{ id: string; jobId: string; status: "completed" | "failed" | "cancelled"; resultText: string }>;
	/** Watched sessions with a turn in flight when the wait returned. */
	stillRunning: string[];
	timedOut: boolean;
}

/** Normalize a text fragment to one bounded roster/trace line. */
function firstLine(text: string, max = 100): string {
	return oneLineLabel(text, max);
}

/** Merge the monitor's rolling `recentTools` window (newest first) into the per-turn trace (oldest first). */
function mergeTrace(turn: UltraTurn, progress: AgentProgress): void {
	turn.toolCount = progress.toolCount;
	for (let i = progress.recentTools.length - 1; i >= 0; i--) {
		const entry = progress.recentTools[i];
		if (turn.trace.some(seen => seen.endMs === entry.endMs && seen.tool === entry.tool && seen.args === entry.args)) {
			continue;
		}
		turn.trace.push({ tool: entry.tool, args: entry.args, endMs: entry.endMs });
		if (turn.trace.length > TURN_TRACE_CAP) turn.trace.shift();
	}
}

/** Thrown from a turn job body so the job manager marks the job failed while carrying the formatted result. */
export class UltraTurnError extends Error {}

/**
 * Process-global registry of ultra worker sessions, scoped per owner agent id
 * (same convention as AsyncJobManager owner filters). The session policy
 * kills an owner's sessions when Ultra thinking exits via {@link killAll}.
 */
export class UltraSessionRegistry {
	static #global: UltraSessionRegistry | undefined;

	static global(): UltraSessionRegistry {
		if (!UltraSessionRegistry.#global) {
			UltraSessionRegistry.#global = new UltraSessionRegistry();
		}
		return UltraSessionRegistry.#global;
	}

	/** Reset the global registry. Test-only. */
	static resetGlobalForTests(): void {
		UltraSessionRegistry.#global = undefined;
	}

	/**
	 * Insert a bare worker record without the spawn/job machinery. Test-only —
	 * lets {@link aggregateUltraWorkerTokensPerSecond} be exercised against a
	 * fake roster + AgentRegistry session without driving a real turn.
	 */
	registerRecordForTests(record: { id: string; ownerId: string; state?: UltraSessionState }): void {
		this.#records.set(record.id, {
			id: record.id,
			ownerId: record.ownerId,
			parentId: MAIN_AGENT_ID,
			agent: getBundledAgent("task")!,
			modelOverride: "test/model",
			state: record.state ?? "running",
			createdAt: Date.now(),
			lastActivityAt: Date.now(),
			queue: [],
			turnCount: 0,
			killed: false,
		});
	}

	readonly #records = new Map<string, UltraRecord>();

	#manager(session: ToolSession): AsyncJobManager {
		const manager = session.asyncJobManager;
		if (!manager) {
			throw new ToolError("Ultra sessions require async execution (no background job manager is available).");
		}
		return manager;
	}

	#record(owner: string, id: string): UltraRecord {
		const record = this.#records.get(id.trim());
		if (!record || record.ownerId !== owner) {
			const roster = this.listIds(owner);
			throw new ToolError(
				`Unknown ultra session "${id}".${roster.length > 0 ? ` Active sessions: ${roster.join(", ")}` : " No Ultra sessions — spawn one with ultra_spawn. Ordinary Task workers are separate and remain visible in Agent Hub."}`,
			);
		}
		return record;
	}

	#visibleState(record: UltraRecord): UltraSessionState {
		if (record.killed || record.state === "dead") return "dead";
		if (record.turn) return "running";
		const status = AgentRegistry.global().get(record.id)?.status;
		if (status === "running") return "running";
		if (status === "idle") return "idle";
		if (status === "parked") return "parked";
		if (status === "aborted") return "dead";
		return record.state;
	}

	/**
	 * Rebuild an explicitly journaled owner roster after process restart. Only
	 * r3 lifecycle entries whose child session contract says `workerKind=ultra`
	 * are eligible; leftover r2 JSONL files are never guessed into the roster.
	 */
	async restorePersistedRoster(
		owner: string,
		cwd: string,
		entries: readonly UltraWorkerLifecycleEntry[],
		recordLifecycle?: UltraLifecycleRecorder,
		ownerSessionFile?: string | null,
	): Promise<UltraRosterRestoreOutcome> {
		const restored: string[] = [];
		const skipped: UltraRosterRestoreIssue[] = [];
		const registry = AgentRegistry.global();
		// JSONL loading is deliberately tolerant of custom/forward entries, so do
		// not trust the compile-time lifecycle shape at this restart boundary.
		// Normalize every path-sensitive field before it reaches String/path APIs.
		const candidates = entries.map(rawEntry => {
			const entry = rawEntry as Partial<UltraWorkerLifecycleEntry> | null | undefined;
			const workerId = typeof entry?.workerId === "string" ? entry.workerId.trim() : "";
			const sessionFile =
				typeof entry?.sessionFile === "string" && entry.sessionFile.trim().length > 0
					? entry.sessionFile.trim()
					: undefined;
			const modelOverride =
				typeof entry?.modelOverride === "string" && entry.modelOverride.trim().length > 0
					? entry.modelOverride.trim()
					: undefined;
			const valid =
				entry?.type === "ultra_worker_lifecycle" &&
				entry.action === "spawn" &&
				entry.ownerId === owner &&
				workerId.length > 0 &&
				sessionFile !== undefined &&
				modelOverride !== undefined;
			return { entry, workerId, sessionFile, modelOverride, valid };
		});
		const activeIds = new Set(candidates.filter(candidate => candidate.valid).map(candidate => candidate.workerId));
		const staleRecords = [...this.#records.values()].filter(
			record => record.ownerId === owner && !activeIds.has(record.id) && this.#visibleState(record) !== "dead",
		);
		for (const record of staleRecords) await this.#killRecord(record, undefined, false);
		for (const { entry, workerId, sessionFile, modelOverride, valid } of candidates) {
			const fail = (reason: string): void => {
				skipped.push({ workerId: workerId || "<invalid>", reason });
			};
			if (!entry || !valid || !sessionFile || !modelOverride) {
				fail("persisted roster metadata is incomplete");
				continue;
			}
			if (ownerSessionFile) {
				const ownerArtifactsDir = ownerSessionFile.slice(0, -6);
				try {
					const stat = await fs.lstat(sessionFile);
					const [realSessionFile, realOwnerArtifactsDir] = await Promise.all([
						fs.realpath(sessionFile),
						fs.realpath(ownerArtifactsDir),
					]);
					if (stat.isSymbolicLink() || path.dirname(realSessionFile) !== realOwnerArtifactsDir) {
						fail("worker session is outside the owning transcript artifact directory");
						continue;
					}
				} catch (error) {
					fail(`worker session is unavailable: ${error instanceof Error ? error.message : String(error)}`);
					continue;
				}
			}
			const current = this.#records.get(workerId);
			if (current && current.ownerId === owner && this.#visibleState(current) !== "dead") {
				continue;
			}

			let persisted: Awaited<ReturnType<typeof SessionManager.peekSessionInit>>;
			try {
				await fs.stat(sessionFile);
				persisted = await SessionManager.peekSessionInit(sessionFile);
			} catch (error) {
				fail(`worker session is unavailable: ${error instanceof Error ? error.message : String(error)}`);
				continue;
			}
			if (persisted?.init?.workerKind !== "ultra") {
				fail("worker session lacks a compatible Ultra session-init contract");
				continue;
			}
			if (persisted.init.agentId !== workerId) {
				fail("worker session belongs to a different worker id");
				continue;
			}
			if (path.resolve(persisted.cwd) !== path.resolve(cwd)) {
				fail(`worker belongs to a different workspace (${persisted.cwd})`);
				continue;
			}

			const parentId =
				typeof entry.workerParentId === "string" && entry.workerParentId.trim().length > 0
					? entry.workerParentId.trim()
					: owner;
			const existing = registry.get(workerId);
			if (
				existing &&
				(existing.kind !== "sub" ||
					existing.workerKind === "task" ||
					(existing.parentId !== undefined && existing.parentId !== parentId) ||
					(existing.sessionFile !== null &&
						existing.sessionFile !== undefined &&
						path.resolve(existing.sessionFile) !== path.resolve(sessionFile)))
			) {
				fail("worker id conflicts with an existing agent registration");
				continue;
			}
			if (!existing?.session) {
				registry.register({
					id: workerId,
					displayName: persisted.init.agentName ?? "ultra",
					kind: "sub",
					workerKind: "ultra",
					parentId,
					session: null,
					sessionFile,
					status: "parked",
				});
			} else {
				registry.setWorkerIdentity(workerId, "ultra", persisted.init.agentName ?? "ultra");
			}

			this.#records.set(workerId, {
				id: workerId,
				ownerId: owner,
				parentId,
				agent: createUltraWorkerAgent(),
				modelOverride,
				sessionFile,
				recordLifecycle,
				state: registry.get(workerId)?.status === "idle" ? "idle" : "parked",
				createdAt:
					typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
				lastActivityAt: Date.now(),
				lastActivity: "restored from owning session",
				resolvedModel: modelOverride,
				queue: [],
				turnCount:
					typeof entry.turns === "number" && Number.isInteger(entry.turns) && entry.turns >= 0 ? entry.turns : 0,
				killed: false,
			});
			restored.push(workerId);
		}
		return { restored, skipped };
	}

	#sessionFileFor(session: ToolSession, workerId: string): string | undefined {
		const ownerSessionFile = session.getSessionFile();
		return ownerSessionFile ? path.join(ownerSessionFile.slice(0, -6), `${workerId}.jsonl`) : undefined;
	}

	#activeLifecycleEvent(record: UltraRecord, reason?: string): UltraLifecycleEvent {
		return {
			workerId: record.id,
			action: "spawn",
			workerParentId: record.parentId,
			sessionFile: record.sessionFile,
			modelOverride: record.modelOverride,
			createdAt: record.createdAt,
			turns: record.turnCount,
			reason,
		};
	}

	#recordTerminalLifecycle(record: UltraRecord, reason: string): void {
		if (record.lifecycleClosed) return;
		record.recordLifecycle?.({
			workerId: record.id,
			action: "kill",
			workerParentId: record.parentId,
			sessionFile: record.sessionFile,
			modelOverride: record.modelOverride,
			createdAt: record.createdAt,
			turns: record.turnCount,
			reason,
		});
		record.lifecycleClosed = true;
	}

	listIds(owner: string): string[] {
		const ids: string[] = [];
		for (const record of this.#records.values()) {
			if (record.ownerId === owner && this.#visibleState(record) !== "dead") ids.push(record.id);
		}
		return ids;
	}

	/**
	 * Live screen snapshots for rich rendering (the "TV wall"): one entry per
	 * session in creation order, carrying the in-flight turn's trace, current
	 * tool, and streamed text tail. All strings are one-line sanitized here so
	 * renderers can print them verbatim.
	 */
	screens(owner: string, ids?: string[]): UltraScreenSnapshot[] {
		const wanted = ids?.length ? new Set(ids.map(id => id.trim())) : undefined;
		const records: UltraRecord[] = [];
		for (const record of this.#records.values()) {
			if (record.ownerId !== owner) continue;
			if (wanted && !wanted.has(record.id)) continue;
			records.push(record);
		}
		// Stable TV-wall ordering: spawn order, not activity order.
		records.sort((a, b) => a.createdAt - b.createdAt);
		return records.map(record => ({
			id: record.id,
			state: this.#visibleState(record),
			model: record.resolvedModel,
			turns: record.turnCount,
			queued: record.queue.length,
			turnStartedAt: record.turn?.startedAt,
			turnMessage: record.turn ? firstLine(record.turn.message, 80) : undefined,
			currentTool: record.live?.currentTool,
			currentToolArgs: record.live?.currentToolArgs ? firstLine(record.live.currentToolArgs, 60) : undefined,
			lastIntent: record.live?.lastIntent ? firstLine(record.live.lastIntent, 80) : undefined,
			trace: record.turn
				? record.turn.trace
						.slice(-6)
						.map(entry => firstLine(`${entry.tool}${entry.args ? `(${entry.args})` : ""}`, TRACE_LINE_MAX))
				: [],
			outputTail: (record.live?.outputTail ?? []).map(line => firstLine(line, 100)),
			lastActivity: record.lastActivity,
			lastActivityAt: record.lastActivityAt,
		}));
	}

	/** Spawn a persistent worker session and start its first turn in the background. */
	async spawn(
		session: ToolSession,
		args: { name?: string; prompt: string; fork_turns?: string },
	): Promise<UltraSpawnOutcome> {
		const owner = session.getAgentId?.() ?? MAIN_AGENT_ID;
		const manager = this.#manager(session);
		const agent = createUltraWorkerAgent();
		const activeModel = session.getActiveModel?.();
		const modelOverride = activeModel ? formatModelStringWithRouting(activeModel) : session.getActiveModelString?.();
		if (!modelOverride) throw new ToolError("Ultra workers require an active model.");
		let inheritedContext: string | undefined;
		try {
			const forkTurns = parseUltraForkTurns(args.fork_turns);
			if (forkTurns !== "none") {
				const snapshot = session.getForkableConversationSnapshot?.();
				if (!snapshot) {
					throw new Error('This host cannot snapshot the parent conversation. Retry with fork_turns "none".');
				}
				inheritedContext = buildUltraForkContext(snapshot, forkTurns, args.prompt)?.text;
			}
		} catch (error) {
			throw new ToolError(error instanceof Error ? error.message : String(error));
		}

		if (!session.agentOutputManager) {
			session.agentOutputManager = new AgentOutputManager(session.getArtifactsDir ?? (() => null));
		}
		const requestedName = args.name?.replace(/[^A-Za-z0-9_-]+/g, "").slice(0, 48);
		const id = await session.agentOutputManager.allocate(requestedName || generateTaskName());
		const sessionFile = this.#sessionFileFor(session, id);

		const record: UltraRecord = {
			id,
			ownerId: owner,
			parentId: owner,
			agent,
			modelOverride,
			sessionFile,
			recordLifecycle: session.recordUltraWorkerLifecycle,
			inheritedContext,
			state: "starting",
			createdAt: Date.now(),
			lastActivityAt: Date.now(),
			queue: [],
			turnCount: 0,
			killed: false,
		};
		this.#records.set(id, record);

		let jobId: string | undefined;
		try {
			record.recordLifecycle?.(this.#activeLifecycleEvent(record));
			jobId = this.#registerTurnJob(session, manager, record, args.prompt, { first: true });
			return { id, jobId };
		} catch (error) {
			if (jobId) manager.cancel(jobId, { ownerId: owner });
			this.#recordTerminalLifecycle(record, "spawn failed before launch completed");
			await AgentLifecycleManager.global()
				.release(id)
				.catch(() => undefined);
			this.#records.delete(id);
			throw error;
		}
	}

	/**
	 * Send a message to a worker. Mid-turn and streaming → steering; mid-turn
	 * otherwise → queued for the next turn; idle/parked → starts a new
	 * background turn immediately.
	 */
	async send(session: ToolSession, args: { session: string; message: string }): Promise<UltraSendOutcome> {
		const owner = session.getAgentId?.() ?? MAIN_AGENT_ID;
		const record = this.#record(owner, args.session);
		if (this.#visibleState(record) === "dead") {
			throw new ToolError(`Ultra session "${record.id}" is dead. Spawn a new one with ultra_spawn.`);
		}
		const message = args.message.trim();
		if (!message) throw new ToolError("Message must not be empty.");

		if (record.turn) {
			const live = AgentRegistry.global().get(record.id)?.session;
			if (live?.isStreaming) {
				await live.steer(message);
				record.lastActivityAt = Date.now();
				return { id: record.id, mode: "steered" };
			}
			record.queue.push(message);
			record.lastActivityAt = Date.now();
			return { id: record.id, mode: "queued" };
		}

		const manager = this.#manager(session);
		const jobId = this.#registerTurnJob(session, manager, record, message, { first: false });
		return { id: record.id, mode: "turn", jobId };
	}

	/**
	 * Block until one watched session's in-flight turn settles, the timeout
	 * elapses, or `signal` aborts — `hub` wait semantics. Settled turns are
	 * acknowledged against the job manager so their results are not delivered
	 * a second time as async follow-ups.
	 */
	async wait(
		session: ToolSession,
		args: { sessions?: string[]; timeoutMs?: number; signal?: AbortSignal },
	): Promise<UltraWaitOutcome> {
		const owner = session.getAgentId?.() ?? MAIN_AGENT_ID;
		const manager = this.#manager(session);
		// Named sessions are watched regardless of state (a just-settled turn is
		// reported from its retained job); the no-args form watches every
		// session with a turn actually in flight.
		const watched = args.sessions?.length
			? args.sessions.map(id => this.#record(owner, id))
			: [...this.#records.values()].filter(record => record.ownerId === owner && record.turn !== undefined);

		// Snapshot each watched turn's job at entry: #finishTurn installs a
		// queued follow-up turn inside the settling job's callback (before that
		// job's promise resolves), so re-reading record.turn after the race
		// would inspect the *next* running job and silently drop the settled
		// result — whose async delivery watchJobs is suppressing on our behalf.
		const snapshots: Array<{ record: UltraRecord; jobId: string }> = [];
		for (const record of watched) {
			const jobId = record.turn?.jobId ?? record.lastJobId;
			if (jobId) snapshots.push({ record, jobId });
		}

		const collectSettled = (): UltraWaitOutcome["settled"] => {
			const settled: UltraWaitOutcome["settled"] = [];
			for (const { record, jobId } of snapshots) {
				const job = manager.getJob(jobId);
				if (!job || job.status === "running") continue;
				settled.push({
					id: record.id,
					jobId,
					status: job.status,
					resultText: job.resultText ?? job.errorText ?? "(no output)",
				});
			}
			return settled;
		};

		const runningJobs: AsyncJob[] = [];
		for (const { jobId } of snapshots) {
			const job = manager.getJob(jobId);
			if (job?.status === "running") runningJobs.push(job);
		}

		let waited = false;
		if (runningJobs.length > 0 && collectSettled().length === 0) {
			waited = true;
			const timeoutMs = Math.max(1, Math.trunc(args.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS));
			const watchedJobIds = runningJobs.map(job => job.id);
			manager.watchJobs(watchedJobIds);
			const { promise: timeoutPromise, resolve: timeoutResolve } = Promise.withResolvers<void>();
			const timeoutHandle = setTimeout(() => timeoutResolve(), timeoutMs);
			const racePromises: Promise<unknown>[] = [...runningJobs.map(job => job.promise), timeoutPromise];
			let abortCleanup: (() => void) | undefined;
			if (args.signal) {
				const { promise: abortPromise, resolve: abortResolve } = Promise.withResolvers<void>();
				const onAbort = () => abortResolve();
				args.signal.addEventListener("abort", onAbort, { once: true });
				abortCleanup = () => args.signal?.removeEventListener("abort", onAbort);
				racePromises.push(abortPromise);
			}
			try {
				await Promise.race(racePromises);
			} finally {
				manager.unwatchJobs(watchedJobIds);
				clearTimeout(timeoutHandle);
				abortCleanup?.();
			}
		}

		const settled = collectSettled();
		manager.acknowledgeDeliveries(settled.map(entry => entry.jobId));
		// Current in-flight state, independent of the snapshot: a session whose
		// watched turn settled may already be mid queued follow-up.
		const stillRunning = watched.filter(record => record.turn !== undefined).map(record => record.id);
		return { settled, stillRunning, timedOut: waited && settled.length === 0 };
	}

	/** Terminate a worker: cancel its in-flight turn and dispose + unregister its session. */
	async kill(session: ToolSession, id: string): Promise<UltraKillOutcome> {
		const owner = session.getAgentId?.() ?? MAIN_AGENT_ID;
		const record = this.#record(owner, id);
		this.#recordTerminalLifecycle(record, "explicit ultra_kill");
		return this.#killRecord(record, session.asyncJobManager, false);
	}

	/** Durable kill path for Agent Hub/collab controls that only carry a worker id. */
	async killRegistered(id: string): Promise<UltraKillOutcome> {
		const record = this.#records.get(id.trim());
		if (!record || this.#visibleState(record) === "dead") {
			throw new Error(`Ultra worker "${id}" is not addressable in its owning roster.`);
		}
		this.#recordTerminalLifecycle(record, "explicit Agent Hub kill");
		return this.#killRecord(record, AsyncJobManager.instance(), false);
	}

	/** Kill every session belonging to `owner`. AgentSession normally journals one clear marker first. */
	async killAll(
		owner: string,
		manager?: AsyncJobManager,
		options: { journal?: boolean; reason?: string } = {},
	): Promise<number> {
		const records = [...this.#records.values()].filter(
			record => record.ownerId === owner && this.#visibleState(record) !== "dead",
		);
		if (options.journal !== false && records.length > 0) {
			records[0]?.recordLifecycle?.({
				workerId: "*",
				action: "clear",
				reason: options.reason ?? "owner roster terminated",
			});
		}
		let killed = 0;
		for (const record of records) {
			await this.#killRecord(record, manager, false);
			killed++;
		}
		return killed;
	}

	/**
	 * Forget live runtime state while leaving the owner's spawn journal active.
	 * The next process/session restore reconstructs these workers as parked and
	 * never replays the interrupted in-flight turn or in-memory queue.
	 */
	async preserveAll(
		owner: string,
		manager: AsyncJobManager | undefined,
		disposition: "park" | "shutdown",
	): Promise<number> {
		const records = [...this.#records.values()].filter(
			record => record.ownerId === owner && this.#visibleState(record) !== "dead",
		);
		for (const record of records) {
			record.lifecycleClosed = true;
			record.killed = true;
			record.queue.length = 0;
			if (record.turn && manager) manager.cancel(record.turn.jobId, { ownerId: record.ownerId });
			record.state = "parked";
			try {
				await AgentLifecycleManager.global().release(record.id, { ultraWorkers: disposition });
			} catch (error) {
				logger.warn("ultra: failed to preserve worker session", {
					id: record.id,
					error: error instanceof Error ? error.message : String(error),
				});
			}
			this.#records.delete(record.id);
		}
		return records.length;
	}

	async #killRecord(
		record: UltraRecord,
		manager: AsyncJobManager | undefined,
		journal: boolean,
	): Promise<UltraKillOutcome> {
		if (journal) this.#recordTerminalLifecycle(record, "worker terminated");
		// Fence the parent before awaiting descendant teardown. A cancelled turn can
		// still unwind through #finishTurn while a child release is pending; without
		// this terminal state, that late completion would append a new spawn marker
		// after the kill/clear marker and resurrect the worker on restart.
		record.killed = true;
		record.lifecycleClosed = true;
		record.queue.length = 0;
		let cancelledTurn = false;
		if (record.turn && manager) {
			cancelledTurn = manager.cancel(record.turn.jobId, { ownerId: record.ownerId });
		}
		record.state = "dead";
		record.lastActivityAt = Date.now();
		record.lastActivity = "killed";

		const descendants = [...this.#records.values()].filter(
			child => child.ownerId === record.id && this.#visibleState(child) !== "dead",
		);
		if (descendants.length > 0) {
			descendants[0]?.recordLifecycle?.({
				workerId: "*",
				action: "clear",
				reason: `parent ${record.id} terminated`,
			});
			for (const child of descendants) await this.#killRecord(child, manager, false);
		}
		try {
			await AgentLifecycleManager.global().release(record.id, { ultraWorkers: "terminal" });
		} catch (error) {
			logger.warn("ultra: failed to release worker session", {
				id: record.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		return { id: record.id, cancelledTurn };
	}

	/** Build the ExecutorOptions for a first spawn, mirroring the `task`/eval-bridge plumbing. */
	async #buildSpawnOptions(
		session: ToolSession,
		record: UltraRecord,
		message: string,
		signal: AbortSignal,
		onProgress: (progress: AgentProgress) => void,
	): Promise<ExecutorOptions> {
		const sessionFile = session.getSessionFile();
		const sessionArtifactsDir = sessionFile ? sessionFile.slice(0, -6) : null;
		const artifactsDir = sessionArtifactsDir ?? path.join(os.tmpdir(), `pi-ultra-${Snowflake.next()}`);
		await fs.mkdir(artifactsDir, { recursive: true });
		if (!sessionArtifactsDir) registerArtifactsDir(artifactsDir);
		const localProtocolOptions: LocalProtocolOptions = session.localProtocolOptions ?? {
			getArtifactsDir: session.getArtifactsDir ?? (() => null),
			getSessionId: session.getSessionId ?? (() => null),
		};
		return {
			cwd: session.cwd,
			agent: record.agent,
			task: message,
			assignment: message,
			description: "ultra worker session",
			index: 0,
			id: record.id,
			taskDepth: session.taskDepth ?? 0,
			detached: true,
			modelOverride: record.modelOverride,
			parentActiveModelPattern: record.modelOverride,
			thinkingLevel: record.agent.thinkingLevel,
			ultraWorker: true,
			sessionFile,
			persistArtifacts: Boolean(sessionFile),
			artifactsDir,
			enableLsp: (session.enableLsp ?? true) && session.settings.get("task.enableLsp"),
			signal,
			eventBus: session.eventBus,
			onProgress,
			authStorage: session.authStorage,
			modelRegistry: session.modelRegistry,
			settings: session.settings,
			mcpManager: session.mcpManager ?? MCPManager.instance(),
			contextFiles: session.contextFiles?.filter(file => path.basename(file.path).toLowerCase() !== "agents.md"),
			skills: [...(session.skills ?? [])],
			workspaceTree: session.workspaceTree,
			promptTemplates: session.promptTemplates,
			rules: session.rules,
			preloadedExtensionPaths: session.extensionPaths,
			preloadedCustomToolPaths: session.customToolPaths,
			localProtocolOptions,
			parentArtifactManager: session.getArtifactManager?.() ?? undefined,
			parentHindsightSessionState: session.getHindsightSessionState?.(),
			parentMnemopiSessionState: session.getMnemopiSessionState?.(),
			parentTelemetry: session.getTelemetry?.(),
			parentEvalSessionId: session.getEvalSessionId?.() ?? undefined,
			parentAgentId: session.getAgentId?.() ?? MAIN_AGENT_ID,
			parentServiceTier: session.getServiceTierByFamily ? (session.getServiceTierByFamily() ?? null) : undefined,
			context: record.inheritedContext,
			keepAlive: true,
		};
	}

	/** Register one background job that runs a single worker turn and self-delivers its result. */
	#registerTurnJob(
		session: ToolSession,
		manager: AsyncJobManager,
		record: UltraRecord,
		message: string,
		options: { first: boolean },
	): string {
		const turnIndex = record.turnCount + 1;
		const turn: UltraTurn = {
			jobId: "",
			message,
			startedAt: Date.now(),
			trace: [],
			toolCount: 0,
		};
		const onProgress = (progress: AgentProgress): void => {
			mergeTrace(turn, progress);
			record.resolvedModel = progress.resolvedModel ?? record.resolvedModel;
			// recentOutput is newest-first; keep the latest lines oldest-first for display.
			record.live = {
				currentTool: progress.currentTool,
				currentToolArgs: progress.currentToolArgs,
				lastIntent: progress.lastIntent,
				outputTail: progress.recentOutput.slice(0, 3).reverse(),
			};
			const gist =
				progress.lastIntent ??
				(progress.currentTool ? `${progress.currentTool} ${progress.currentToolArgs ?? ""}` : undefined);
			if (gist) record.lastActivity = firstLine(gist);
			record.lastActivityAt = Date.now();
		};

		const jobId = manager.register(
			"task",
			`ultra ${record.id}: ${firstLine(message, 60)}`,
			async ({ jobId: ownJobId, signal }) => {
				record.state = "running";
				record.turnCount = turnIndex;
				record.lastActivityAt = Date.now();
				try {
					const result = options.first
						? await runSubprocess(await this.#buildSpawnOptions(session, record, message, signal, onProgress))
						: await runSubagentFollowUpTurn({
								id: record.id,
								agent: record.agent,
								message,
								description: "ultra worker session",
								signal,
								onProgress,
								eventBus: session.eventBus,
								artifactsDir: session.getSessionFile()?.slice(0, -6),
							});
					return this.#settleTurn(session, manager, record, turn, ownJobId, turnIndex, result);
				} catch (error) {
					if (error instanceof UltraTurnError) throw error;
					this.#finishTurn(session, manager, record, ownJobId);
					const reason = error instanceof Error ? error.message : String(error);
					record.lastActivity = firstLine(`turn failed: ${reason}`);
					throw new UltraTurnError(`[ultra:${record.id} turn=${turnIndex}] turn failed: ${reason}`);
				}
			},
			{ id: `${record.id}-t${turnIndex}`, agentId: record.id, ownerId: record.ownerId },
		);
		turn.jobId = jobId;
		record.turn = turn;
		return jobId;
	}

	/** Post-turn bookkeeping shared by success and failure paths: clear the in-flight turn, flush the queue. */
	#finishTurn(session: ToolSession, manager: AsyncJobManager, record: UltraRecord, settledJobId: string): void {
		record.lastJobId = settledJobId;
		record.turn = undefined;
		record.live = undefined;
		record.lastActivityAt = Date.now();
		if (record.killed) {
			record.state = "dead";
			return;
		}
		// A spawn that failed before its session ever registered leaves nothing
		// to continue. Persist that terminal state so a crash/restart cannot turn
		// the optimistic spawn marker into a phantom parked worker.
		const ref = AgentRegistry.global().get(record.id);
		if (!ref || ref.status === "aborted") {
			record.state = "dead";
			this.#recordTerminalLifecycle(record, "worker turn ended without a resumable session");
			return;
		}
		record.state = ref.status === "parked" ? "parked" : ref.status === "running" ? "running" : "idle";
		record.recordLifecycle?.(this.#activeLifecycleEvent(record, "turn settled"));
		if (record.queue.length === 0) return;
		const nextMessage = record.queue.splice(0, record.queue.length).join("\n\n");
		try {
			this.#registerTurnJob(session, manager, record, nextMessage, { first: false });
		} catch (error) {
			// Leave the messages recoverable: a later ultra_send flushes again.
			record.queue.unshift(nextMessage);
			logger.warn("ultra: failed to start queued follow-up turn", {
				id: record.id,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/** Format a settled turn into the self-delivering result text (activity trace + response). */
	#settleTurn(
		session: ToolSession,
		manager: AsyncJobManager,
		record: UltraRecord,
		turn: UltraTurn,
		settledJobId: string,
		turnIndex: number,
		result: SingleResult,
	): string {
		this.#finishTurn(session, manager, record, settledJobId);
		const failed = result.exitCode !== 0 || result.aborted === true;
		const status = result.aborted ? "aborted" : failed ? "failed" : "completed";
		record.lastActivity = firstLine(
			failed
				? `turn ${turnIndex} ${status}: ${result.abortReason ?? result.error ?? ""}`
				: (result.lastIntent ?? result.output),
		);

		const traceLines = turn.trace.map(entry =>
			firstLine(`${entry.tool}${entry.args ? `(${entry.args})` : ""}`, TRACE_LINE_MAX),
		);
		const traceOverflow = Math.max(0, turn.toolCount - turn.trace.length);
		let response = result.output.trim() || "(no output)";
		let responseTruncated = false;
		if (response.length > RESPONSE_PREVIEW_MAX) {
			const slice = response.slice(0, RESPONSE_PREVIEW_MAX);
			const lastNewline = slice.lastIndexOf("\n");
			response = lastNewline > 0 ? slice.slice(0, lastNewline) : slice;
			responseTruncated = true;
		}
		let text: string;
		try {
			text = prompt
				.render(ultraTurnResultTemplate, {
					id: record.id,
					turn: turnIndex,
					status,
					duration: formatDuration(result.durationMs),
					requests: result.requests,
					toolCount: turn.toolCount,
					model: result.resolvedModel ?? record.resolvedModel ?? "",
					trace: traceLines,
					traceOverflow: traceOverflow > 0 ? traceOverflow : undefined,
					response,
					responseTruncated,
					error: failed ? (result.abortReason ?? result.error ?? result.stderr ?? "") : "",
					alive: record.state !== "dead",
				})
				.trim();
		} catch (error) {
			// A formatting bug must never turn a finished worker turn into a false
			// failure — the work is done; degrade to a plain-text assembly.
			logger.warn("ultra: turn-result template render failed; using plain fallback", {
				id: record.id,
				error: error instanceof Error ? error.message : String(error),
			});
			text = [
				`[ultra:${record.id} turn=${turnIndex} status=${status}]`,
				`Activity (${turn.toolCount} tool calls, ${result.requests} requests):`,
				...traceLines.map(line => `- ${line}`),
				"",
				"Response:",
				response,
			].join("\n");
		}
		if (failed) throw new UltraTurnError(text);
		return text;
	}
}

/**
 * Aggregate tok/s across every live Ultra worker session owned by `ownerId`.
 * Returns null when no workers are streaming (so callers can fall back to
 * their own rate unchanged). The director is often idle while workers stream,
 * so without this aggregation the status-line tok/s badge would show a stale
 * value while parallel work is actively generating tokens.
 *
 * Reads each worker's last assistant message via {@link calculateTokensPerSecond}
 * — the same leaf calculator the main status line uses — so worker rates are
 * computed identically to the main session's rate.
 */
export function aggregateUltraWorkerTokensPerSecond(ownerId: string): number | null {
	const ids = UltraSessionRegistry.global().listIds(ownerId);
	if (ids.length === 0) return null;
	let total = 0;
	let any = false;
	const registry = AgentRegistry.global();
	for (const id of ids) {
		const workerSession = registry.get(id)?.session;
		if (!workerSession?.isStreaming) continue;
		const rate = calculateTokensPerSecond(workerSession.state.messages, true);
		if (rate !== null) {
			total += rate;
			any = true;
		}
	}
	return any ? total : null;
}
