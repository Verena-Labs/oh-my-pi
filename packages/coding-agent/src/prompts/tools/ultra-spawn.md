Starts a persistent worker session — a fully capable coding agent that shares your workspace and that you drive by conversation.

`prompt` is the session's first instruction. The worker starts with NO context beyond it, so include the objective, files or system in scope, constraints, and acceptance criteria. `name` (optional) labels the session; otherwise one is generated.

Returns immediately with the session id. The turn's result (activity trace and the worker's response) is delivered to you automatically when the worker finishes. Continue useful direct work or orchestrate other independent sessions instead of waiting unnecessarily.

The session persists after the turn and remembers the whole conversation. Continue it with `ultra_send`; never spawn a second session for a follow-up on the same workstream.

Workers share the workspace with you. Give sessions bounded, non-overlapping ownership when possible, and personally reconcile any overlapping changes.
