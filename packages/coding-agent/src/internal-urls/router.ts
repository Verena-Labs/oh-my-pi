/**
 * Internal URL router for Pi's selected protocols (`agent://`, `artifact://`, `history://`, `local://`, `mcp://`, `memory://`, `pi://`, `skill://`, `ssh://`, and `vault://`).
 *
 * One process-global router with one handler per scheme. Access via
 * `InternalUrlRouter.instance()`. Handlers are stateless; per-session and
 * shared state lives in `./state.ts`.
 */
import { isBunTestRuntime } from "@oh-my-pi/pi-utils";
import { AgentProtocolHandler } from "./agent-protocol";
import { ArtifactProtocolHandler } from "./artifact-protocol";
import { HistoryProtocolHandler } from "./history-protocol";
import { LocalProtocolHandler } from "./local-protocol";
import { McpProtocolHandler } from "./mcp-protocol";
import { MemoryProtocolHandler } from "./memory-protocol";
import { PiProtocolHandler } from "./omp-protocol";
import { parseInternalUrl } from "./parse";
import { SkillProtocolHandler } from "./skill-protocol";
import { SshProtocolHandler } from "./ssh-protocol";
import {
	type InternalResource,
	type InternalUrl,
	PI_INTERNAL_PROTOCOL_SCHEMES,
	type ProtocolHandler,
	type ResolveContext,
	type UrlCompletion,
} from "./types";
import { VaultProtocolHandler } from "./vault-protocol";

const PI_INTERNAL_PROTOCOL_SCHEME_SET: ReadonlySet<string> = new Set(PI_INTERNAL_PROTOCOL_SCHEMES);

export class InternalUrlRouter {
	static #instance: InternalUrlRouter | undefined;

	#handlers = new Map<string, ProtocolHandler>();

	constructor() {
		this.#registerBuiltin(new PiProtocolHandler());
		this.#registerBuiltin(new AgentProtocolHandler());
		this.#registerBuiltin(new ArtifactProtocolHandler());
		this.#registerBuiltin(new MemoryProtocolHandler());
		this.#registerBuiltin(new LocalProtocolHandler());
		this.#registerBuiltin(new VaultProtocolHandler());
		this.#registerBuiltin(new SkillProtocolHandler());
		this.#registerBuiltin(new McpProtocolHandler());
		this.#registerBuiltin(new HistoryProtocolHandler());
		this.#registerBuiltin(new SshProtocolHandler());
	}

	/** Process-global router instance. */
	static instance(): InternalUrlRouter {
		InternalUrlRouter.#instance ??= new InternalUrlRouter();
		return InternalUrlRouter.#instance;
	}

	/** Reset the global instance in tests. */
	static resetForTests(): void {
		InternalUrlRouter.#instance = undefined;
	}

	#registerBuiltin(handler: ProtocolHandler): void {
		const scheme = handler.scheme.toLowerCase();
		if (!PI_INTERNAL_PROTOCOL_SCHEME_SET.has(scheme)) {
			throw new Error(`Pi internal protocol is not selected: ${scheme}://`);
		}
		this.#handlers.set(scheme, handler);
	}

	/**
	 * Pi's internal-resource surface is immutable. Host/RPC extensions cannot
	 * add schemes or replace the selected handlers.
	 */
	register(_handler: ProtocolHandler): boolean {
		return false;
	}

	/** Install a synthetic handler for behavior tests without opening the runtime registry. */
	registerForTests(handler: ProtocolHandler): void {
		if (!isBunTestRuntime()) {
			throw new Error("Synthetic internal URL handlers are only available in tests");
		}
		this.#handlers.set(handler.scheme.toLowerCase(), handler);
	}

	unregister(_scheme: string): boolean {
		return false;
	}

	getHandler(scheme: string): ProtocolHandler | undefined {
		return this.#handlers.get(scheme.toLowerCase());
	}

	canHandle(input: string): boolean {
		const match = input.match(/^([a-z][a-z0-9+.-]*):\/\//i);
		if (!match) return false;
		return this.#handlers.has(match[1].toLowerCase());
	}

	/** Schemes whose handler supports host/path autocomplete. */
	completionSchemes(): string[] {
		const schemes: string[] = [];
		for (const [scheme, handler] of this.#handlers) {
			if (handler.complete) schemes.push(scheme);
		}
		return schemes;
	}

	/**
	 * Candidate completions for the host/path portion of `scheme://<query>`.
	 * Returns `null` when the scheme is unknown or does not support completion.
	 */
	async complete(scheme: string, query: string, context?: ResolveContext): Promise<UrlCompletion[] | null> {
		const handler = this.#handlers.get(scheme.toLowerCase());
		if (!handler?.complete) return null;
		return handler.complete(query, context);
	}

	async resolve(input: string, context?: ResolveContext): Promise<InternalResource> {
		const parsed = parseInternalUrl(input);
		const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
		const handler = this.#handlers.get(scheme);

		if (!handler) {
			const available = Array.from(this.#handlers.keys())
				.map(s => `${s}://`)
				.join(", ");
			throw new Error(`Unknown protocol: ${scheme}://\nSupported: ${available || "none"}`);
		}

		const resource = await handler.resolve(parsed as InternalUrl, context);
		return { ...resource, immutable: resource.immutable ?? handler.immutable };
	}
}
