Sends a message to one of your worker sessions (by id from `ultra_spawn` / `ultra_list`). The session keeps its full conversation history, so refer to earlier work naturally ("now do the same for the other module").

Returns immediately with an acknowledgment telling you how the message landed:

- `turn` — the worker was idle; a new turn started. Its result self-delivers when done.
- `steered` — the worker was mid-turn; your message was injected into the running turn as live steering.
- `queued` — the worker was mid-turn and not steerable right now; your message runs as the next turn automatically.

Use it for follow-ups, corrections, scope changes, and review requests. Do not re-explain prior context; the session already has it.
