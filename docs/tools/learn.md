# learn

> Capture a reusable lesson in the selected long-term memory backend.

## Source

- Entry: `packages/coding-agent/src/tools/learn.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/learn.md`
- Local memory backend: `packages/coding-agent/src/memory-backend/local-backend.ts`

## Inputs

| Field | Type | Required | Description |
|---|---|---:|---|
| `memory` | `string` | Yes | Durable, self-contained lesson to remember: what, when, and why. |
| `context` | `string` | No | Optional source context for the lesson. |

## Outputs

- Mnemopi and local persistence return `Lesson stored.`
- Hindsight queueing returns `Lesson queued for retention.`

## Flow

1. `LearnTool.createIf(...)` exposes the tool when `memory.backend` is `hindsight`, `mnemopi`, or `local`.
2. Mnemopi calls `rememberScoped(...)` with bank scope, extraction enabled, and the session/project metadata.
3. Local memory appends a bounded, sanitized lesson through `localBackend.save(...)`.
4. Hindsight queues the lesson through `enqueueRetain(memory, context)`.

## Side Effects

- Local memory writes only within the selected project's memory root.
- Hindsight queues server-side retention work.
- Mnemopi writes through the selected session's scoped memory state.
- The tool does not create, update, discover, or delete skills.

## Limits and errors

- The tool is unavailable when `memory.backend` is `off`.
- Missing Mnemopi or Hindsight session state fails clearly.
- Empty local lessons fail without creating a file.
- A legacy or direct `skill` payload is rejected before the memory operation runs.

## Notes

Use this tool sparingly. One precise reusable lesson is better than several vague memories.
