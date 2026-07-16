Blocks until ONE watched session finishes its current turn, the timeout elapses, or you are interrupted — not until all finish. Re-issue to keep waiting.

Turn results normally deliver themselves; you never need this merely to receive output. Use it only when you cannot make useful direct or orchestration progress without a worker result.

- `sessions` — ids to watch. Omit to watch every session with a turn in flight.
- `timeout` — seconds to wait (default 30).

A finished turn's full result (activity trace and response) is returned here and will not be re-delivered separately.
