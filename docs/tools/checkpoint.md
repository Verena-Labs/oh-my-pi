# checkpoint

> Mark the current top-level conversation so later `rewind` can replace exploratory context with a concise report.

## Source

- Entry: `packages/coding-agent/src/tools/checkpoint.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/checkpoint.md`
- Key collaborators:
  - `packages/coding-agent/src/session/agent-session.ts` captures and reconstructs checkpoint state.
  - `packages/coding-agent/src/session/session-manager.ts` persists the ordinary checkpoint tool result used as the resumable boundary.
  - `packages/coding-agent/src/tools/index.ts` registers both checkpoint tools and gates them behind `checkpoint.enabled`.

## Input

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `goal` | `string` | Yes | A name for the investigation goal. |

## Output

The tool returns:

- `Checkpoint created.`
- `Goal: <goal>`
- `Run your investigation, then call rewind with a concise report.`
- structured details containing `goal` and an ISO `startedAt` timestamp.

It does not return a file snapshot, Git reference, artifact, job, or external restore token.

## Flow

1. Only a top-level session can create a checkpoint; subagents reject the call.
2. A second checkpoint is rejected while one is active.
3. The tool emits an ordinary successful tool result. That result is persisted in the normal append-only session journal.
4. `AgentSession` records the result's entry ID and timestamp as the active conversation boundary.
5. On resume or session reconstruction, `AgentSession` scans the active branch. A successful checkpoint result without a later retained rewind report restores the active checkpoint, so `rewind` remains available after a process restart.
6. Until rewind completes, yielding injects a reminder to finish the checkpoint with a report.

The runtime marker is private state reconstructed from ordinary session entries; there is no separately exposed checkpoint/session-tree API.

## Limits

- Availability is controlled by `checkpoint.enabled`.
- Top-level sessions only.
- One active checkpoint at a time.
- Conversation context only. Files, Git state, processes, artifacts, credentials, and other external state are neither captured nor restored.
- The named goal labels the investigation for the model; there is no public checkpoint-ID picker or checkpoint tree.

## Errors

- `Checkpoint not available in subagents.`
- `Checkpoint already active.`

## Related

- [`rewind`](rewind.md)
