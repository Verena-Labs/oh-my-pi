import type { SessionManager } from "./session-manager";

/**
 * Private capability shared only by AgentSession and SessionManager. The
 * package manifest blocks this subpath so checkpoint rewind cannot reopen the
 * disabled public session-branching surface through a deep import.
 */
export const CHECKPOINT_CONVERSATION_REWRITE: unique symbol = Symbol("checkpoint-conversation-rewrite");

export interface CheckpointConversationRewrite {
	branchFromId: string | null;
	content: string;
	details: {
		report: string;
		startedAt: string;
		rewoundAt: string;
	};
}

interface CheckpointConversationRewriteCapable {
	[CHECKPOINT_CONVERSATION_REWRITE](rewrite: CheckpointConversationRewrite): string;
}

export function rewriteCheckpointConversation(
	sessionManager: SessionManager,
	rewrite: CheckpointConversationRewrite,
): string {
	return (sessionManager as SessionManager & CheckpointConversationRewriteCapable)[CHECKPOINT_CONVERSATION_REWRITE](
		rewrite,
	);
}
