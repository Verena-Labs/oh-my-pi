# rewind

> End the active checkpoint by restoring its conversation boundary and retaining a concise report.

## Source

- Entry: `packages/coding-agent/src/tools/checkpoint.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/rewind.md`
- Retained-report prompt: `packages/coding-agent/src/prompts/system/rewind-report.md`
- Key collaborators:
  - `packages/coding-agent/src/session/agent-session.ts` validates, applies, and reconstructs rewind state.
  - `packages/coding-agent/src/session/session-manager.ts` provides the private checkpoint-only conversation rewrite capability.

## Input

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `report` | `string` | Yes | Concise investigation findings. Empty text is rejected after trimming. |

## Output

The tool first returns `Rewind requested.` and `Report captured for context replacement.` with structured details containing the trimmed report and `rewound: true`.

The surrounding turn then completes the context rewrite before another model turn begins.

## Flow

1. Only a top-level session with an active checkpoint can call `rewind`.
2. `AgentSession` captures the report from the successful rewind result.
3. At turn end, a private checkpoint-only SessionManager capability moves the active conversation leaf to the checkpoint tool result and appends one hidden `rewind-report` custom message.
4. The active model context is rebuilt from that leaf. Exploratory assistant messages and tool results after the checkpoint no longer participate in the active conversation.
5. The retained report tells the model the checkpoint is complete and remains in ordinary session persistence.
6. The active checkpoint is closed. On resume, the retained `rewind-report` reconstructs completed-rewind state so a repeat call receives guidance to continue instead of rewinding twice.

This path does not call the public `SessionManager.branchWithSummary()` API and does not create a generic `branch_summary` or expose session-tree navigation. The abandoned append-only entries remain in the journal for inspection, while the active context follows the rewritten conversation leaf.

If the recorded checkpoint entry is missing, the same private capability falls back to the conversation root and retains the report there.

## Limits

- Availability is controlled by `checkpoint.enabled`.
- Top-level sessions only, with exactly one active checkpoint.
- The report must be non-empty.
- Conversation context only. Rewind does not change files, Git state, processes, artifacts, blobs, credentials, or other external state.
- Rewind is final for that checkpoint; a repeated call errors with guidance to continue from the retained report.

## Errors

- `Checkpoint not available in subagents.`
- `No active checkpoint. Create a checkpoint before calling rewind.`
- `Checkpoint already completed; continue from the retained rewind report instead of calling rewind again.`
- `Report cannot be empty.`

## Related

- [`checkpoint`](checkpoint.md)
