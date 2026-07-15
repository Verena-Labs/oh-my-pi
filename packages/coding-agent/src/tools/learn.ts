import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { type } from "arktype";
import { localBackend } from "../memory-backend/local-backend";
import learnDescription from "../prompts/tools/learn.md" with { type: "text" };
import type { ToolSession } from ".";

const learnSchema = type({
	memory: type("string").describe("the durable, self-contained lesson to remember (what, when, why)"),
	"context?": type("string").describe("optional source context for the lesson"),
}).onUndeclaredKey("reject");

export type LearnParams = typeof learnSchema.infer;

/**
 * Persist a reusable lesson to the selected memory backend. Pi retains this
 * memory operation independently of OMP's disabled auto-learn controller and
 * managed-skill mutation tools.
 */
export class LearnTool implements AgentTool<typeof learnSchema> {
	readonly name = "learn";
	readonly approval = (_args: unknown) => (this.session.settings.get("memory.backend") === "local" ? "write" : "read");
	readonly label = "Learn";
	readonly description = learnDescription;
	readonly parameters = learnSchema;
	readonly strict = true;
	readonly loadMode = "essential" as const;
	readonly summary = "Capture a reusable lesson to memory";

	constructor(private readonly session: ToolSession) {}

	static createIf(session: ToolSession): LearnTool | null {
		const backend = session.settings.get("memory.backend");
		if (backend !== "hindsight" && backend !== "mnemopi" && backend !== "local") return null;
		return new LearnTool(session);
	}

	async execute(_id: string, params: LearnParams): Promise<AgentToolResult> {
		// The schema is strict, but direct SDK callers can bypass schema validation.
		// Reject the removed OMP payload before storing the lesson so a caller never
		// receives a misleading partial success and managed-skill paths stay inert.
		if ("skill" in (params as object)) {
			throw new Error("Managed skill learning is unavailable in Pi; learn accepts memory and context only.");
		}

		// Persist or queue the lesson to long-term memory (mirrors MemoryRetainTool).
		const backend = this.session.settings.get("memory.backend");
		let memoryMessage = "Lesson stored";
		if (backend === "mnemopi") {
			const state = this.session.getMnemopiSessionState?.();
			if (!state) {
				throw new Error("Mnemopi backend is not initialised for this session.");
			}
			const id = state.rememberScoped(params.memory, {
				source: "coding-agent-learn",
				importance: 0.8,
				metadata: {
					session_id: state.sessionId,
					cwd: state.session.sessionManager.getCwd(),
					context: params.context ?? null,
					tool: "learn",
				},
				scope: "bank",
				extract: true,
				extractEntities: true,
				veracity: "tool",
				memoryType: "fact",
			});
			// rememberScoped returns undefined when the retain failed (closed DB /
			// disk error); mirror mnemopiBackend.save and fail loudly rather than
			// reporting (and minting a skill for) a lesson that was silently dropped.
			if (!id) {
				throw new Error("Mnemopi did not store the lesson (no memory id returned).");
			}
		} else if (backend === "local") {
			const result = await localBackend.save?.(
				{ agentDir: this.session.settings.getAgentDir(), cwd: this.session.settings.getCwd() },
				{ content: params.memory, context: params.context, source: "coding-agent-learn", importance: 0.8 },
			);
			if (!result || result.stored === 0) {
				throw new Error("Lesson was empty after sanitization; nothing stored.");
			}
		} else {
			const state = this.session.getHindsightSessionState?.();
			if (!state) {
				throw new Error("Hindsight backend is not initialised for this session.");
			}
			state.enqueueRetain(params.memory, params.context);
			memoryMessage = "Lesson queued for retention";
		}

		return {
			content: [{ type: "text", text: `${memoryMessage}.` }],
		};
	}
}
