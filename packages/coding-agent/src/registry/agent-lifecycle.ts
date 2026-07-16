/**
 * AgentLifecycleManager - Owns the idle → parked → revived lifecycle of
 * adopted subagents.
 *
 * The task executor hands a finished agent over via {@link AgentLifecycleManager.adopt};
 * from then on the manager arms a TTL timer whenever the agent goes `idle`,
 * parks it on expiry (disposes the live session, keeps the AgentRef +
 * sessionFile), and revives it on demand through
 * {@link AgentLifecycleManager.ensureLive}. Only this manager flips
 * `parked` ↔ `idle`.
 */

import { logger } from "@oh-my-pi/pi-utils";
import type { AgentSession } from "../session/agent-session";
import { type AgentRef, AgentRegistry, MAIN_AGENT_ID, type RegistryEvent } from "./agent-registry";

export type AgentReviver = () => Promise<AgentSession>;

/**
 * Builds a reviver for a `parked` ref restored from disk (Agent Hub scan,
 * collab mirror, resumed process) that carries a sessionFile but no in-memory
 * adoption. Returns undefined when the ref cannot be faithfully rebuilt (no
 * persisted session contract, or its workspace is gone). Injected from the
 * top-level session so this manager stays free of sdk/SessionManager imports.
 */
export type PersistedSubagentReviverFactory = (ref: AgentRef) => Promise<AgentReviver | undefined>;

export interface AdoptOptions {
	/** TTL before an idle agent is parked. <= 0 disables parking. */
	idleTtlMs: number;
	/** Recreates a live AgentSession from the ref's sessionFile. Absent => not resumable after park (e.g. isolated runs). */
	revive?: AgentReviver;
}

interface AdoptedAgent {
	idleTtlMs: number;
	revive?: AgentReviver;
	timer?: NodeJS.Timeout;
}

interface RevivalAttempt {
	fence: { released: boolean };
	promise: Promise<AgentSession>;
}

export class AgentLifecycleManager {
	static #global: AgentLifecycleManager | undefined;

	static global(): AgentLifecycleManager {
		if (!AgentLifecycleManager.#global) {
			AgentLifecycleManager.#global = new AgentLifecycleManager();
		}
		return AgentLifecycleManager.#global;
	}

	/** Reset the global manager. Test-only. */
	static resetGlobalForTests(): void {
		const current = AgentLifecycleManager.#global;
		if (current) {
			current.#unsubscribe?.();
			current.#unsubscribe = undefined;
			for (const adopted of current.#adopted.values()) {
				clearTimeout(adopted.timer);
			}
			current.#adopted.clear();
			for (const attempt of current.#revivals.values()) attempt.fence.released = true;
			current.#revivals.clear();
			current.#parking.clear();
			current.#persistedReviverFactory = undefined;
		}
		AgentLifecycleManager.#global = undefined;
	}

	readonly #registry: AgentRegistry;
	readonly #adopted = new Map<string, AdoptedAgent>();
	/** Ids whose session is being disposed by {@link park} right now. */
	readonly #parking = new Set<string>();
	/** In-flight revives, so concurrent {@link ensureLive} calls coalesce. */
	readonly #revivals = new Map<string, RevivalAttempt>();
	#unsubscribe: (() => void) | undefined;
	#persistedReviverFactory: PersistedSubagentReviverFactory | undefined;
	/** TTL applied when a cold-revived ref is adopted on demand. */
	#persistedReviveTtlMs = 0;

	constructor(registry: AgentRegistry = AgentRegistry.global()) {
		this.#registry = registry;
		this.#unsubscribe = registry.onChange(event => this.#onRegistryEvent(event));
	}

	/**
	 * Install the factory used to cold-revive `parked` refs restored from disk
	 * (Agent Hub scan, collab mirror, resumed process) — they carry a sessionFile
	 * but no adoption. Set by the top-level session, which owns the ambient deps
	 * (auth, models, MCP, artifacts) the factory needs at revive time.
	 */
	setPersistedSubagentReviverFactory(factory: PersistedSubagentReviverFactory, idleTtlMs: number): void {
		this.#persistedReviverFactory = factory;
		this.#persistedReviveTtlMs = idleTtlMs;
	}

	/**
	 * Take ownership of a finished subagent. Caller has already set registry
	 * status to "idle". Arms the TTL timer (idleTtlMs <= 0 adopts without one).
	 */
	adopt(id: string, opts: AdoptOptions): void {
		if (id === MAIN_AGENT_ID) return;
		if (!this.#registry.get(id)) {
			logger.warn("AgentLifecycleManager.adopt: unknown agent id", { id });
			return;
		}
		const existing = this.#adopted.get(id);
		clearTimeout(existing?.timer);
		const adopted: AdoptedAgent = { idleTtlMs: opts.idleTtlMs, revive: opts.revive };
		this.#adopted.set(id, adopted);
		this.#armTimer(id, adopted);
	}

	/** True if the id is adopted (parked or live). */
	has(id: string): boolean {
		return this.#adopted.has(id);
	}

	/** True while {@link park} is disposing this agent's session (lets dispose hooks distinguish park from teardown). */
	isParking(id: string): boolean {
		return this.#parking.has(id);
	}

	/**
	 * Dispose the live session, detach it from the registry, and mark the
	 * agent `parked`. No-op unless the id is adopted and live.
	 */
	async park(id: string): Promise<void> {
		const adopted = this.#adopted.get(id);
		if (!adopted) return;
		const ref = this.#registry.get(id);
		if (!ref?.session) return;
		if (this.#hasRunningDescendant(id)) {
			this.#armTimer(id, adopted);
			return;
		}
		if (adopted.timer) {
			clearTimeout(adopted.timer);
			adopted.timer = undefined;
		}
		this.#parking.add(id);
		try {
			try {
				await ref.session.dispose({ ultraWorkers: "park" });
			} catch (error) {
				logger.warn("AgentLifecycleManager.park: session dispose failed", { id, error: String(error) });
			}
			this.#registry.detachSession(id);
			this.#registry.setStatus(id, "parked");
		} finally {
			this.#parking.delete(id);
		}
	}

	/**
	 * Return the live session, reviving from the sessionFile if parked.
	 * Throws a plain Error if the id is unknown or parked without a reviver.
	 * Concurrent calls share one in-flight revive.
	 */
	async ensureLive(id: string): Promise<AgentSession> {
		const ref = this.#registry.get(id);
		if (!ref) {
			throw new Error(
				`Unknown agent "${id}" — it was never registered or has been released. If a transcript exists, read history://${id}.`,
			);
		}
		if (ref.session) return ref.session;
		const inflight = this.#revivals.get(id);
		if (inflight) return inflight.promise;
		const fence = { released: false };
		const revival = this.#resolveAndRevive(id, ref, fence);
		const attempt: RevivalAttempt = { fence, promise: revival };
		this.#revivals.set(id, attempt);
		try {
			return await revival;
		} finally {
			if (this.#revivals.get(id) === attempt) this.#revivals.delete(id);
		}
	}

	/**
	 * Resolve a reviver and bring the agent back to a live session. A ref
	 * restored from disk is `parked` with a sessionFile but no in-memory
	 * adoption; build a reviver via the injected persisted-subagent factory and
	 * adopt it so the agent rejoins the normal idle↔parked lifecycle. Throws
	 * when the agent is not revivable or no reviver can be produced.
	 */
	async #resolveAndRevive(id: string, ref: AgentRef, fence: { released: boolean }): Promise<AgentSession> {
		let revive = this.#adopted.get(id)?.revive;
		let coldAdopted = false;
		if (!revive && ref.status === "parked" && ref.sessionFile && this.#persistedReviverFactory) {
			revive = await this.#persistedReviverFactory(ref);
			if (revive) {
				if (fence.released) throw new Error(`Agent "${id}" was released while being revived.`);
				this.#adopted.set(id, { idleTtlMs: this.#persistedReviveTtlMs, revive });
				coldAdopted = true;
			}
		}
		if (ref.status !== "parked" || !revive) {
			throw new Error(
				`Agent "${id}" is ${ref.status} and cannot be revived${revive ? "" : " (no reviver registered)"}. Its transcript remains readable at history://${id}.`,
			);
		}
		try {
			return await this.#revive(id, revive, ref.sessionFile, fence);
		} catch (error) {
			// A failed cold revive (stale ctx, missing cwd, bad MCP) must not leave a
			// poisoned reviver stuck in #adopted — drop it so a later ensureLive
			// rebuilds via the factory (which may have fresher context by then).
			if (coldAdopted) this.#adopted.delete(id);
			throw error;
		}
	}

	/** Hard removal: dispose if live, unregister from registry, drop timers. */
	async release(id: string, options: { ultraWorkers?: "terminal" | "park" | "shutdown" } = {}): Promise<void> {
		const revival = this.#revivals.get(id);
		if (revival) revival.fence.released = true;
		const adopted = this.#adopted.get(id);
		clearTimeout(adopted?.timer);
		this.#adopted.delete(id);
		const ref = this.#registry.get(id);
		if (ref?.session) {
			try {
				await ref.session.dispose({ ultraWorkers: options.ultraWorkers ?? "terminal" });
			} catch (error) {
				logger.warn("AgentLifecycleManager.release: session dispose failed", { id, error: String(error) });
			}
		}
		this.#registry.unregister(id);
		if (revival) {
			try {
				await revival.promise;
			} catch {
				// Expected when this release fenced the in-flight revival.
			}
		}
	}

	/** Teardown everything (process exit / main session dispose). */
	async dispose(options: { ultraWorkers?: "terminal" | "shutdown" } = {}): Promise<void> {
		this.#unsubscribe?.();
		this.#unsubscribe = undefined;
		const ids = [...new Set([...this.#adopted.keys(), ...this.#revivals.keys()])];
		await Promise.all(ids.map(id => this.release(id, { ultraWorkers: options.ultraWorkers ?? "shutdown" })));
		this.#revivals.clear();
		this.#parking.clear();
		this.#persistedReviverFactory = undefined;
	}

	async #revive(
		id: string,
		revive: AgentReviver,
		sessionFile: string | null,
		fence: { released: boolean },
	): Promise<AgentSession> {
		const session = await revive();
		if (fence.released) {
			try {
				await session.dispose({ ultraWorkers: "terminal" });
			} catch (error) {
				logger.warn("AgentLifecycleManager: failed to dispose a revival completed after release", {
					id,
					error: String(error),
				});
			}
			this.#registry.unregister(id);
			throw new Error(`Agent "${id}" was released while being revived.`);
		}
		this.#registry.attachSession(id, session, sessionFile);
		// Emits status_changed → "idle", which re-arms the TTL timer below.
		this.#registry.setStatus(id, "idle");
		return session;
	}

	#armTimer(id: string, adopted: AdoptedAgent): void {
		if (adopted.idleTtlMs <= 0) return;
		clearTimeout(adopted.timer);
		const timer = setTimeout(() => {
			adopted.timer = undefined;
			void this.park(id);
		}, adopted.idleTtlMs);
		timer.unref?.();
		adopted.timer = timer;
	}

	#hasRunningDescendant(id: string): boolean {
		for (const ref of this.#registry.list()) {
			if (ref.status !== "running") continue;
			let parentId = ref.parentId;
			const seen = new Set<string>();
			while (parentId && !seen.has(parentId)) {
				if (parentId === id) return true;
				seen.add(parentId);
				parentId = this.#registry.get(parentId)?.parentId;
			}
		}
		return false;
	}

	#onRegistryEvent(event: RegistryEvent): void {
		const adopted = this.#adopted.get(event.ref.id);
		if (!adopted) return;
		if (event.type === "removed") {
			clearTimeout(adopted.timer);
			this.#adopted.delete(event.ref.id);
			return;
		}
		if (event.type !== "status_changed") return;
		if (event.ref.status === "running") {
			if (adopted.timer) {
				clearTimeout(adopted.timer);
				adopted.timer = undefined;
			}
		} else if (event.ref.status === "idle") {
			this.#armTimer(event.ref.id, adopted);
		}
	}
}
