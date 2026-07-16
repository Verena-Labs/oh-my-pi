# Oh My Pi Runtime Capability Matrix

Last reviewed: 2026-07-15

This matrix is the canonical capability allowlist and negative contract for the Verena Labs downstream Oh My Pi (OMP) runtime. It identifies the user-facing feature families that the pinned OMP base adds beyond upstream Pi core, records exactly which capabilities this fork exposes through its `pi` runtime, and retains the Codex and Claude Code comparisons that informed those choices.

This is not a porting checklist. The fork starts from OMP's implementation and disables unwanted capability families at their registration, bootstrap, prompt, and UI boundaries. Disabled source may remain in the fork; source deletion is not a release requirement.

## Snapshot and scope

- Initial upstream base snapshot: Oh My Pi checkout 3047c27c33, package version 16.5.0. Advance this base only through the fork's recorded upstream-sync workflow.
- Distribution boundary: users launch the runtime as `pi`. Internal OMP package names may remain unchanged, and no separate user-facing `omp` command is required.
- Packaging boundary: this source fork owns engine behavior, the `pi` executable build substrate, and the shared behavioral contract. Each consuming distribution owns its platform/support claims, installation and update mechanism, artifact hashes, and release smoke evidence.
- Comparison basis: current built-in behavior, not a raw fork diff. Oh My Pi's recorded upstream synchronization point is older than current Pi, so a raw diff would misattribute features. See the [OMP porting guide](docs/porting-from-pi-mono.md) and [current upstream Pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).
- Codex includes its current CLI, desktop app, IDE/cloud surfaces, and first-party bundled plugins.
- Claude Code includes its current CLI, desktop app, IDE surfaces, and official integrations.
- A dash means no documented equivalent was found; it does not mean the feature would be impossible to build through third-party extensibility.

### Capability decision legend

- **ENABLE** — Expose and support the OMP capability family with its native interaction quality and lifecycle.
- **ENABLE NARROWED** — Expose only the subset stated in Notes. The remainder of that OMP capability family follows the DISABLE contract.
- **DISABLE** — Keep the OMP-specific capability unavailable. It must not be registered as a command or tool, advertised in prompts/help/completion, initialized in the background, or activated implicitly through configuration or magic words. It must not perform discovery, network, credential, or persistent-state work. Add negative acceptance coverage for its absence.
- **BASELINE ONLY** — Disable the OMP-specific addition while preserving the corresponding ordinary Pi-compatible behavior already present in the pinned OMP baseline and stated in Notes.

Every row is an explicit runtime decision. Code may remain present and buildable behind a gate, but a disabled capability must be behaviorally absent. A future change requires updating this matrix and its positive or negative acceptance coverage before enabling the capability.

### Product-comparison legend

- ✅ Essentially the same first-party capability
- ◐ Overlapping capability, but narrower, surface-gated, experimental, or semantically different
- 🧩 Can be assembled through a plugin, MCP server, hook, skill, SDK, or shell tool
- — No documented equivalent found

### Current-source corrections

Current source takes precedence over stale README marketing:

These statements correct the inventory of the pinned OMP base; they do not override the runtime decisions in the matrix rows.

- Eval currently registers Python, Bun JavaScript, Ruby, and Julia.
- The provider catalog currently contains 61 provider descriptors.
- Web search currently exposes 23 explicit providers plus auto.
- There are 13 routed internal URI schemes, plus separately handled conflict resources.
- generate_image and TTS are conditional tools, not members of the canonical 32 built-in tools.
- Checkpoint and rewind rewrite conversation context only; they do not restore files or Git.
- Marketplace npm sources are parsed, but npm marketplace installation is currently rejected.
- Approval mode defaults to yolo; critical-command detection only prompts or denies when the selected policy calls for it.

Evidence: [eval registration](packages/coding-agent/src/tools/index.ts), [provider descriptors](packages/catalog/src/provider-models/descriptors.ts), [search providers](packages/coding-agent/src/web/search/types.ts), [URI router](packages/coding-agent/src/internal-urls/router.ts), [canonical built-ins](packages/coding-agent/src/tools/builtin-names.ts), [checkpoint semantics](docs/tools/checkpoint.md), [marketplace caveat](docs/marketplace.md), and [approval semantics](docs/approval-mode.md).

## Pi-compatible baseline inherited through OMP

The following are ordinary Pi-compatible behaviors already present in the pinned OMP base and are not feature-selection rows. This does not claim that pinned OMP is synchronized with current upstream Pi. They remain part of the `pi` baseline unless another authoritative distribution document explicitly narrows them:

- Terminal UI, editor, streaming tool cards, and basic themes
- Basic read, write, edit, bash, grep, find, and file completion
- Provider registration, authentication, model switching, and thinking controls
- JSONL sessions, resume, tree branching, fork/clone, and baseline compaction
- AGENTS.md and CLAUDE.md context, system/append context, and prompt templates
- Ordinary skills, TypeScript extensions, custom tools, packages, and hot reload
- Interactive, print, JSON, RPC, and SDK entry points
- Basic HTML/JSONL export and gist sharing
- Basic tool allowlists and project trust

## Agent orchestration and workflows

Comparison sources: Codex [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees), [app-server](https://learn.chatgpt.com/docs/app-server), and [developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli); Claude Code [subagents](https://code.claude.com/docs/en/sub-agents), [agent teams](https://code.claude.com/docs/en/agent-teams), [worktrees](https://code.claude.com/docs/en/worktrees), and [goals](https://code.claude.com/docs/en/goal).

| Notes | ID — Oh My Pi addition | Codex | Claude Code |
|---|---|---:|---:|
| ENABLE — Keep OMP's built-in plan mode, plan review, and separate plan-model routing. | 01 — Built-in plan mode, plan review, and separate plan-model routing | ◐ | ◐ |
| ENABLE — Keep persistent and guided goals with budgets and auto-continuation. | 02 — Persistent and guided goals with budgets and auto-continuation | ✅ | ✅ |
| ENABLE — Keep first-class parallel typed subagents. | 03 — First-class parallel typed subagents | ✅ | ✅ |
| DISABLE — Do not automatically isolate subagents in worktrees or integrate their patches and branches. | 04 — Automatic subagent worktree isolation and patch/branch integration | ◐ | ✅ |
| ENABLE — Keep OMP's complete native agent-result system: schemas declared by agent definitions, inherited parent-session schemas, and explicit ad-hoc eval schemas; schema-validated incremental and final yield/report submission; and durable, queryable `agent://` full-result resources. Agents without a schema continue to return ordinary text, and non-isolated agents remain steerable and resumable. Manual isolation retains its native terminal lifecycle, while automatic worktree isolation remains disabled independently under ID 04. | 05 — Schema-validated agent results, agent resources, and report/yield tools | ◐ | ◐ |
| ENABLE — Keep the Agent Hub for inspecting, steering, pausing, killing, parking, and reviving agents. | 06 — Agent hub: inspect, steer, pause, kill, park, and revive | ◐ | ◐ |
| ENABLE — Keep direct peer-to-peer agent messaging/IRC. | 07 — Direct peer-to-peer agent messaging/IRC | ◐ | ◐ Experimental |
| ENABLE — Keep the always-on advisor/watchdog roster using independent models. | 08 — Always-on advisor/watchdog roster using independent models | — | — |
| ENABLE — Keep multi-agent review with priority, confidence, and ship verdict. | 09 — Multi-agent review with priority, confidence, and ship verdict | ◐ | ◐ |
| ENABLE NARROWED — Keep `/btw` only: an ephemeral, current-context, no-tools, single-response side question that does not enter conversation history. Disable `/tan` and full-context background tangential forks. | 10 — Ephemeral side questions and background tangential agents | ◐ | ✅ `/btw`; ◐ `/tan` |
| ENABLE — Keep OMP's persistent director/worker substrate as Pi's Ultra composite thinking tier. Offer Ultra only when the current model exposes controllable reasoning effort. Selecting it keeps the main agent on that model, requests `xhigh` clamped to the model's highest supported effort, preserves its complete active toolset, and adds exactly `ultra_spawn`, `ultra_send`, `ultra_wait`, `ultra_kill`, and `ultra_list`. Each direct Ultra worker snapshots the main agent's current model and resolved effort when spawned through one generic full-capability worker definition outside the ordinary named task-agent catalog, with no worker tier/model selector; every descendant inherits that root snapshot. Existing worker trees remain pinned to their spawn-time model and effort, while later direct spawns use the main agent's newly selected model. Preserve continued turns, steering and queued follow-ups, waiting and cancellation, owner isolation, Agent Hub integration, and the native live multi-worker wall. Ordinary `xhigh` remains a separate reasoning-only selection. Ultra is selected only through the existing thinking-level controls: do not register `/ultra`, `/delegate`, `/vibe`, `delegate_*`, or `vibe_*`, and do not resume or render them through compatibility paths. | 11 — Ultra same-model orchestration thinking tier and live worker wall | ◐ | ◐ |
| ENABLE — Keep OMP's complete configurable magic-keyword system: standalone lowercase `ultrathink`, `orchestrate`, and `workflowz` in ordinary prose receive their native editor highlighting and inject the corresponding hidden thinking, multi-agent orchestration, or deterministic workflow guidance. Preserve global and per-keyword settings plus native prose boundaries so code, markup, substrings, and differently cased words do not trigger it. The one-turn `ultrathink` notice remains distinct from the persistent Ultra composite thinking tier under ID 11 and must not activate its tools or workers. | 12 — Magic orchestration keywords such as orchestrate and workflowz | 🧩 | ◐ |
| ENABLE — Keep persistent phased TODO/task tracking that is visible to both user and agent and survives compaction. | 13 — Persistent phased to-do system surviving compaction | ◐ | ✅ |
| ENABLE — Keep the background-job manager, including listing, waiting, cancellation, and automatic backgrounding of suitable long-running work. | 14 — Background-job manager with wait, cancel, and auto-backgrounding | ✅ | ✅ |
| ENABLE — Keep structured agent-to-user questions with single-select, multiselect, and free-text responses. | 15 — Structured agent-to-user forms: picker, multiselect, and free text | ✅ | ✅ |
| ENABLE — Keep read/write/exec approval tiers and configurable per-tool permission policies. | 16 — Read/write/exec approval tiers and per-tool policies | ✅ | ✅ |
| ENABLE — Keep bounded loop mode for intentionally resubmitting the same prompt after each completed iteration, with count/duration limits and explicit cancellation. | 17a — Repeating prompt loop mode with count and duration limits | ◐ | ◐ |
| ENABLE — Keep the explicit fast/priority toggle for requesting a provider's lower-latency service tier without changing the selected model. | 17b — Fast/priority provider service-tier control | ◐ | ◐ |
| ENABLE — Keep the ability to require a named tool on the model's next turn without fixing its arguments or constraining later tool calls. | 17c — Force-next-tool control | ◐ | ◐ |
| DISABLE — A dedicated Git wrapper is unnecessary; ordinary agents and reusable skills can perform commit splitting, message generation, changelog updates, validation, and pushing through the command line when requested. | 18 — Agentic atomic commit splitting, validation, changelog, and optional push | 🧩 | 🧩 |
| ENABLE — Keep first-class managed long-running processes for development servers, watchers, REPLs, debuggers, and local services. Preserve stable names, readiness checks, reusable logs and stdin, signals, restart/stop controls, project sharing, and automatic lifecycle cleanup instead of treating them as ordinary background terminal commands. | 19 — Supervised process launcher with readiness probes, logs, signals, and restart | ◐ | ◐ |
| ENABLE — Keep prewalk as an explicit or configurable workflow: let the current strong model investigate, produce the plan and TODOs, and begin implementation, then hand the prepared context to a configured fast/cheap model at the first edit or write. Preserve `/prewalk`, startup flags, and model-role targeting. | 20 — Prewalk planning/reconnaissance followed by model handoff | ◐ | ◐ |
| ENABLE — Keep reusable YAML-defined multi-agent workflows with sequential, parallel, and arbitrary dependency-graph execution, per-agent roles/models, validation, repeat counts, and persisted status/logs. Treat this as a nice-to-have declarative layer over the core orchestration system. | 21 — YAML multi-agent swarm/DAG executor | ◐ | ◐ |
| DISABLE — The specialized autonomous benchmark-optimization research loop is unnecessary for this `pi` distribution. | 22 — Autonomous benchmark-optimization autoresearch loop | 🧩 | 🧩 |
| DISABLE — No dedicated CI-green wrapper is needed; an ordinary agent or optional skill can inspect GitHub Actions, fix failures, push, and continue until CI passes when explicitly requested. | 23 — Green loop that iterates until CI passes | 🧩 | ◐ |

OMP evidence: [slash-command registry](packages/coding-agent/src/slash-commands/builtin-registry.ts), [task-agent configuration](docs/task-agent-discovery.md), [advisor/watchdog](docs/advisor-watchdog.md), and [agentic commit pipeline](packages/coding-agent/src/commit/agentic/index.ts).

## Files, editing, execution, and developer tools

Comparison sources: Codex [browser](https://learn.chatgpt.com/docs/browser), [computer use](https://learn.chatgpt.com/docs/computer-use), [web search](https://learn.chatgpt.com/docs/web-search), [MCP](https://learn.chatgpt.com/docs/extend/mcp), and [image inputs](https://learn.chatgpt.com/docs/image-inputs); Claude Code [tool reference](https://code.claude.com/docs/en/tools-reference), [Chrome](https://code.claude.com/docs/en/chrome), [computer use](https://code.claude.com/docs/en/computer-use), and [MCP](https://code.claude.com/docs/en/mcp).

| Notes | ID — Oh My Pi addition | Codex | Claude Code |
|---|---|---:|---:|
| ENABLE — Keep OMP's complete unified rich-reader engine for local text, directories, images, Office/PDF/EPUB/RTF documents, archives, read-only SQLite access, editable notebook text, web URLs, SSH-backed resources, and internal resources. Selector behavior remains governed independently by ID 26, and actual virtual-resource protocol registration by ID 31. | 24 — Unified rich read: Office/PDF/EPUB, archives, SQLite, notebooks, URLs, SSH, and internal resources | ◐ | ◐ |
| ENABLE — Keep OMP's complete native rich-mutation paths: create or replace archive entries, insert/update/delete SQLite rows, write through writable internal-resource handlers, and round-trip cell-marked notebook edits back into valid `.ipynb` JSON while preserving applicable metadata. Office/PDF/EPUB conversion remains read-only; OMP does not implement structural writes for those document formats. | 25 — Rich write/edit into archive entries, SQLite rows, writable internal resources, and notebook cells | 🧩 | ◐ |
| ENABLE — Keep OMP's actual structural-summary and selection system: automatic tree-sitter summaries with explicit elision metadata and concrete reread ranges; an explicit selector field and path-suffix grammar for single, open-ended, counted, and merged multi-line ranges plus raw mode; and the archive, SQLite, converted-document, URL, internal-resource, notebook, PDF-image, and `agent://` JSON extraction paths supplied by their owning rich-read features. OMP does not implement the previously claimed page, cell, JSONPath, XPath, or symbol selector language. Conflict inspection/resolution remains a separate decision under ID 30. | 26 — Structural summaries and the actual rich-read selection system | 🧩 | 🧩 |
| ENABLE — Keep OMP's complete hashline edit mode: eligible mutable `read`, grep, and AST-search output receives content-derived snapshot tags and numbered anchors; constrained edit operations consume those anchors; stale snapshots recover only when the original target can be relocated exactly and otherwise fail with contextual mismatch evidence; and successful writes return fresh tags for continued editing. Preserve snapshot bounds, immutable/raw fallbacks, multi-file behavior, and native no-op safeguards. | 27 — Hashline-anchored editing with stale-anchor detection | — | — |
| ENABLE — Keep OMP's configurable high-confidence fuzzy content matching for its alternate patch and replace edit modes, including ambiguity rejection, dominant-match thresholds, warnings, and an exact-only off mode. Also keep strict generated-file and lockfile guards across write/edit paths so agents are directed to source inputs instead of mutating derived output. Hashline editing remains exact under ID 27; unique missing-path suffix resolution belongs to the rich reader under ID 24 rather than this row. | 28 — Optional fuzzy patch/replace matching plus generated-file edit guards | ◐ | ◐ |
| ENABLE — Keep first-class structural code search and preview-first AST codemods, including metavariable patterns, staged apply/discard, and stale-preview detection. | 29 — AST queries and staged AST transformations with preview/resolve | 🧩 | 🧩 |
| ENABLE — Keep OMP's complete first-class conflict workflow: detect and register two-way and diff3 marker blocks, inspect complete or `ours`/`theirs`/`base` scoped `conflict://` resources, resolve one block or an explicitly selected/all registered set, expand native side shorthands, reject stale anchors, preserve surrounding content, and return fresh hashline snapshots. | 30 — First-class conflict resources and targeted/bulk resolution | — | — |
| ENABLE NARROWED — Register exactly `local://`, `agent://`, `artifact://`, `history://`, `mcp://`, `memory://`, `skill://`, `vault://`, `ssh://`, and renamed embedded-documentation `pi://` handlers. These support selected plans and coordination, durable agent results and transcripts, oversized-output recovery, MCP, project memory, skills, Obsidian, remote rich-file access, and self-documentation. Do not register `issue://`, `pr://`, `rule://`, legacy `omp://`, arbitrary RPC/host-defined schemes, or any other protocol; their owning capabilities are disabled or unselected. `conflict://` remains the separate purpose-built workflow under ID 30. | 31 — Common virtual resource filesystem for agents, artifacts, history, MCP, memory, skills, vaults, SSH, and embedded Pi docs | ◐ | ◐ |
| ENABLE — Keep OMP's complete opt-in Obsidian integration: discover configured and active vaults, browse/read/write vault-contained files, and expose the native Obsidian CLI-backed backlinks, tags, tasks, history, templates, search, properties, and vault operations through `vault://`. Preserve explicit enablement, binary detection, timeouts, root-containment and symlink-escape checks, and clear unavailable behavior. ID 31 must retain the `vault://` protocol when its deferred resource-router scope is finalized. | 32 — Obsidian vault operations: backlinks, tags, tasks, history, and templates | 🧩 | 🧩 |
| ENABLE — Keep built-in fast regex, glob, and tree search as part of the selected Codex and Claude Code capability union. | 33 — Built-in fast regex/glob/tree search | ✅ | ✅ |
| ENABLE — Keep the embedded cross-platform shell/PTY with interception and persistence as part of the selected Codex and Claude Code capability union. | 34 — Embedded cross-platform shell/PTY with interception and persistence | ✅ | ◐ |
| ENABLE — Keep OMP's bounded-output spill mechanism: when a supported tool result exceeds its conversation/display limit, preserve the complete sanitized output in the session artifact store, return accurate truncation metadata and a readable `artifact://` recovery reference, and clean it up with the owning session lifecycle. ID 31 must retain the `artifact://` protocol when its deferred resource-router scope is finalized. | 35 — Oversized tool-output spill into session-local artifacts | ◐ | ◐ |
| DISABLE — Do not expose persistent Python, Bun JavaScript, Ruby, or Julia eval kernels. | 36 — Persistent Python, Bun JavaScript, Ruby, and Julia eval kernels | 🧩 | ◐ Notebook-only |
| DISABLE — Do not allow eval kernels to call back into tools/subagents or run parallel batches and pipelines. | 37 — Eval calls back into tools/subagents, parallel batches, and pipelines | 🧩 | 🧩 |
| ENABLE — Keep persistent language-server integration for diagnostics, navigation, symbols, semantic references and renames, file renames, code actions, formatting, capabilities, and raw requests. | 38 — 14-operation LSP tool with write diagnostics, formatting, and rename events | 🧩 | ◐ Official plugin |
| DISABLE — Do not expose the dedicated DAP debugger or its gdb, lldb, debugpy, delve, rdbg, and custom adapters. | 39 — 28-operation DAP debugger with gdb, lldb, debugpy, delve, rdbg, and custom adapters | 🧩 | 🧩 |
| ENABLE — Keep persistent named browser tabs with headless Chromium and CDP attachment, ARIA inspection, screenshots, uploads, scripted interaction, navigation/network waits, and raw Puppeteer access. | 40 — Persistent CDP browser with visible Chrome/Electron, ARIA, screenshots, uploads, and raw Puppeteer | ◐ | ◐ |
| ENABLE NARROWED — Expose one configurable `web_search` tool with normalized cited results, a user-selected default provider, native Codex/OpenAI and credential-free DuckDuckGo adapters, and an optional explicitly enabled fallback. Disable the broad automatic provider cascade and package/forum/security-specific handlers. | 41 — Unified configurable web search (narrowed from OMP's broad provider cascade) | ◐ | ◐ |
| DISABLE — Do not expose OMP's separate persistent SSH session/tool surface or related CLI. The bounded `ssh://` remote-file read/search/write resource selected under IDs 24 and 31 remains available through the ordinary rich file tools rather than a dedicated SSH tool. | 42 — Dedicated persistent SSH session/tool surface | ◐ | ◐ |
| DISABLE — Do not expose GitHub as a filesystem, PR worktrees, or streaming Actions/log watching. | 43 — GitHub as a filesystem plus PR worktrees and streaming Actions/log watching | ◐ | ◐ |
| ENABLE — Keep image inspection as part of the selected Codex and Claude Code capability union. | 44 — Image inspection | ✅ | ✅ |
| ENABLE — Keep conditional multi-provider image generation and editing as part of the selected Codex and Claude Code capability union. | 45 — Conditional multi-provider image generation and editing | ✅ Bundled | — |
| DISABLE — Do not expose push-to-talk speech transcription. | 46 — Push-to-talk speech transcription | ◐ | ◐ Gated |
| DISABLE — Do not expose conditional TTS file generation or streamed assistant narration. | 47 — Conditional TTS file generation and streamed assistant narration | — | — |
| ENABLE — Keep named conversation-only checkpoint and rewind as part of the selected Codex and Claude Code capability union. | 48 — Named conversation-only checkpoint and rewind | ◐ | ✅ |
| ENABLE — Keep BM25 lazy tool discovery and activation modes as part of the selected Codex and Claude Code capability union. | 49 — BM25 lazy tool discovery and activation modes | ◐ | ✅ Tool Search |
| ENABLE — Keep the built-in MCP client for stdio/HTTP/SSE, OAuth, resources, prompts, and notifications as part of the selected Codex and Claude Code capability union. | 50 — Built-in MCP client: stdio/HTTP/SSE, OAuth, resources, prompts, and notifications | ✅ | ✅ |
| DISABLE — Do not enable mid-generation rule matching, abort, guidance injection, or retry. | 51 — Mid-generation rule matching, abort, guidance injection, and retry | ◐ Hooks only | ◐ Hooks only |
| ENABLE — Keep OMP's complete bundled terminal/runtime substrate: native text copy and image-paste clipboard integration, syntax-highlighted tool and code presentation, terminal image-protocol detection plus SIXEL encoding/passthrough, process inspection and children-first tree termination, and the cross-platform isolation primitives available to separately enabled features. This supplies primitives rather than overriding feature policy: automatic subagent worktree isolation remains disabled under ID 04. | 52 — Bundled terminal runtime: clipboard, highlighting, sixel/images, process tree, and isolation | ◐ | ◐ |
| ENABLE — Keep OMP's configurable model-output and tool-call loop guards plus fabricated-tool-result protection: detect repeated reasoning/prose and excessive planning-without-action streams, interrupt and redirect them; detect repeated identical tool calls across turns with configurable thresholds and exemptions; and discard fabricated tool-result continuations, optionally aborting the provider stream immediately. Unexpected-stop classification/continuation remains a separate disabled decision under ID 63, while adaptive job polling belongs to enabled ID 14 rather than this row. | 53 — Model/tool loop guards and fabricated-tool-result protection | ◐ | ◐ |

OMP evidence: [rich read](docs/tools/read.md), [write](docs/tools/write.md), [LSP](docs/tools/lsp.md), [debugger](docs/tools/debug.md), [browser prompt](packages/coding-agent/src/prompts/tools/browser.md), and [TTSR lifecycle](docs/ttsr-injection-lifecycle.md).

## Memory, context, and sessions

Comparison sources: Codex [memories](https://learn.chatgpt.com/docs/customization/memories), [rules](https://learn.chatgpt.com/docs/agent-configuration/rules), and [app-server threads](https://learn.chatgpt.com/docs/app-server); Claude Code [memory](https://code.claude.com/docs/en/memory), [sessions](https://code.claude.com/docs/en/sessions), [context window](https://code.claude.com/docs/en/context-window), and [checkpointing](https://code.claude.com/docs/en/checkpointing).

| Notes | ID — Oh My Pi addition | Codex | Claude Code |
|---|---|---:|---:|
| ENABLE — Keep autonomous project-memory extraction, consolidation, and relevant summary injection. | 54 — Autonomous project memory extraction, consolidation, and summary injection | ✅ | ✅ |
| ENABLE — Keep the Mnemopi/Hindsight episodic-memory backend and its retain, recall, reflect, and learn operations. | 55 — Mnemopi/Hindsight episodic backends with retain, recall, reflect, and learn | ◐ | ◐ |
| DISABLE — Do not expose dedicated tools for agent-managed skill creation or learning. | 56 — Agent-managed skill creation and learning through dedicated tools | ◐ | ◐ |
| DISABLE — Do not automatically import or discover Claude, Codex, Gemini, Cursor, Copilot, or other tools' configuration. | 57 — Automatic import/discovery of Claude, Codex, Gemini, Cursor, Copilot, and other configs | ◐ Selected import | 🧩 |
| DISABLE — Do not enable the sticky conditional rulebook, scoped activation, or rule resources. | 58 — Sticky conditional rulebook with scoped activation and rule resources | ◐ | ◐ |
| DISABLE — Do not expose snapcompact, shake, promotion, remote-compaction controls or arbitrary endpoints, pruning, or handoff. Retain provider-native compaction internally as part of Pi's baseline long-session implementation. | 59 — Snapcompact, shake, promotion, remote compaction, pruning, and handoff | ◐ | ◐ |
| DISABLE — Do not expose OMP's extra fresh, move, drop, retry, handoff, or cross-project resume session operations. | 60 — Extra session operations: fresh, move, drop, retry, handoff, and cross-project resume | ◐ | ◐ |
| DISABLE — Do not expose the searchable OMP session tree with filters, labels, summaries, or switching. | 61 — Searchable session tree with filters, labels, summaries, and switching | ◐ | ◐ |
| ENABLE — Keep the separate SQLite/FTS5 prompt-history database and Ctrl-R search surface without enabling the richer searchable session tree from ID 61. | 62 — Separate SQLite/FTS5 prompt history with Ctrl-R search | ◐ | ◐ |
| DISABLE — Do not enable unexpected-stop classification, automatic continuation, or idle recap. | 63 — Unexpected-stop classification, auto-continuation, and idle recap | ◐ | ◐ |
| DISABLE — Do not expose OMP export/share additions for subagent transcripts or structured session trees. | 64 — Export/share including subagent transcripts and structured session trees | ◐ | ◐ |

OMP evidence: [memory system](docs/memory.md), [Mnemopi](docs/mnemosyne-memory-backend.md), [cross-tool context loading](docs/context-files.md), [compaction](docs/compaction.md), and [session tree](docs/tree.md).

## Models, providers, routing, and configuration

Comparison sources: Codex [advanced model-provider configuration](https://learn.chatgpt.com/docs/config-file/config-advanced) and [custom subagent models](https://learn.chatgpt.com/docs/agent-configuration/subagents); Claude Code [model configuration](https://code.claude.com/docs/en/model-config) and [LLM gateways](https://code.claude.com/docs/en/llm-gateway).

| Notes | ID — Oh My Pi addition | Codex | Claude Code |
|---|---|---:|---:|
| ENABLE — Keep the broad built-in provider catalog, including subscription-backed providers and local model runtimes. | 65 — Catalog of 61 provider descriptors, including subscriptions and local runtimes | ◐ | ◐ |
| ENABLE — Keep custom YAML provider definitions, multiple API protocols, and runtime capability/model discovery. | 66 — Custom YAML providers, multiple API protocols, and runtime capability discovery | ◐ | ◐ |
| ENABLE — Keep configurable model-role routing so features and agents can request purpose-specific roles such as default, smol, slow, plan, vision, designer, commit, tiny, task, and advisor without hard-coding provider/model IDs. Ultra remains a session thinking tier under ID 11, not a model role or a replacement for the independently configurable `slow` role. | 67 — Automatic role-based model routing | ◐ | ◐ |
| DISABLE — Do not enable provider/model fallback chains, cooldowns, or retry routing. | 68 — Provider/model fallback chains with cooldowns and retry routing | — | — |
| DISABLE — Do not pool credentials with round-robin selection or session affinity. | 69 — Round-robin credentials with session affinity | — | — |
| DISABLE — Do not enable folder-scoped model/provider policy; ordinary project configuration is sufficient. | 70 — Path-scoped models and providers | ◐ | — |
| ENABLE NARROWED — Keep OMP's native `/models` hub for discovery, provider login, model selection, role assignment, pricing metadata, and recorded TTFT/TPS; keep the separate `/usage` and `pi usage` provider-limit surfaces plus the explicitly invoked `pi bench` model benchmark. Disable fallback-chain editing under ID 68 and do not invent a combined legacy `/model-hub` command. | 71 — Model discovery and role hub plus usage, performance, and explicit model benchmarking surfaces | ◐ | ◐ |
| ENABLE — Keep the bundled local tiny-model pipeline for inexpensive local routing, classification, titles, memory work, and other lightweight background tasks. | 72 — Bundled local tiny-model pipeline for cheap routing/classification | 🧩 | — |
| DISABLE — Do not enable centralized remote credential-broker or proxy infrastructure; it is unnecessary for the intended local `pi` setup. | 73 — Auth broker/gateway with token vault, SSH OAuth callback, and proxy APIs | 🧩 | ◐ Gateway only |
| ENABLE — Keep service-tier, sampling, reasoning-effort, verbosity, and provider-specific request controls. Include Ultra as a coding-agent composite selector for models with controllable reasoning effort: it preserves the active model, requests `xhigh` clamped to the model's highest supported effort, and activates the ID 11 orchestration policy without sending `ultra` as a provider effort or accepting it as a model-selector suffix. Ordinary `xhigh` remains independently selectable and does not activate orchestration. | 74 — Service tiers, sampling, reasoning, verbosity, and provider-specific controls | ✅ | ◐ |
| DISABLE — Use one `pi` user environment; do not expose named profiles that separately scope authentication, sessions, settings, caches, skills, and extensions. A temporary isolated state directory during development is a test safeguard, not a user-facing profile feature. | 75 — Named profiles isolating essentially all user state | ✅ | ◐ |
| DISABLE — Do not automatically obfuscate outbound secret values before model requests. | 76 — Automatic outbound secret-value obfuscation before model requests | — | — |

OMP evidence: [provider catalog](packages/catalog/src/provider-models/descriptors.ts), [settings](docs/settings.md), [auth broker/gateway](docs/auth-broker-gateway.md), [profiles](docs/config-usage.md), and [secret handling](docs/secrets.md).

## Extensibility, collaboration, UI, and distribution

Comparison sources: Codex [plugins](https://learn.chatgpt.com/docs/plugins), [hooks](https://learn.chatgpt.com/docs/hooks), [remote connections](https://learn.chatgpt.com/docs/remote-connections), and [sandboxing](https://learn.chatgpt.com/docs/sandboxing); Claude Code [plugins](https://code.claude.com/docs/en/plugins), [hooks](https://code.claude.com/docs/en/hooks), [desktop](https://code.claude.com/docs/en/desktop), and [remote control](https://code.claude.com/docs/en/remote-control).

| Notes | ID — Oh My Pi addition | Codex | Claude Code |
|---|---|---:|---:|
| ENABLE — Keep OMP's full plugin manager and Claude-compatible marketplace ecosystem alongside its normal Pi-extension compatibility. Preserve local, Git, GitHub, Git-subdirectory, and direct-catalog sources; user/project scopes; install, enable, disable, upgrade, and uninstall flows; plugin-provided skills, commands, agents, hooks, tools, MCP, and LSP content; and the native configurable `off`/`notify`/`auto` marketplace-update lifecycle. Marketplace npm sources remain explicitly unsupported until OMP implements them. | 77 — Claude-compatible plugin marketplace/manager and ecosystem bridges; local/Git sources work, npm install does not currently | ◐ | ✅ |
| ENABLE — Keep OMP's runtime plugin/config hot reload, including atomic adoption of extension, command, tool, hook, provider, and configuration changes without restarting the active process. | 78 — Runtime plugin/config hot reload | ◐ | ◐ |
| DISABLE — Do not expose or initialize OMP's live E2E-encrypted multiuser collaboration, control/view links, QR flow, guest agents, or relay. | 79 — Live E2E-encrypted multiuser collaboration with control/view links, QR, guest agents, and self-hostable relay | — | — |
| DISABLE — Do not expose or initialize OMP's encrypted static transcript snapshot sharing. | 80 — Encrypted static transcript snapshot sharing | ◐ Cloud sharing | ◐ Cloud sharing |
| DISABLE — Do not expose or initialize OMP's ACP editor-agent protocol endpoint or ACP permission routing. | 81 — ACP editor-agent protocol endpoint with permission routing | ◐ Different protocol | — |
| ENABLE — Keep OMP's configurable rich status line, including its Git, LSP, agent, job, model, mode, path, context, usage, cost, output, PR, and timing segments; minimal/default/full/custom presets; responsive layout; separators, transparency, and session accents; and colorblind presentation. | 82 — Rich status line with Git, LSP, agents, usage, presets, and colorblind modes | ✅ | ✅ |
| ENABLE — Keep OMP's full-screen model, agent, plugin, job, tool, and context hubs plus its richer keyboard and mouse TUI interactions. Hubs must reflect the capabilities actually available in this distribution rather than resurrecting a disabled built-in surface. | 83 — Full-screen model/agent/plugin/job/tool/context hubs and richer mouse TUI | ◐ App panels | ◐ Desktop panels |
| ENABLE — Keep OMP's dynamic bash, zsh, and fish completion, including model- and session-aware values, adapted to the public `pi` command and the distribution's enabled CLI surface. | 84 — Dynamic bash/zsh/fish completion, including model/session-aware values | ◐ Basic completion | — |
| ENABLE — Keep OMP's configurable desktop and terminal notifications plus speech attention cues. These attention features remain separate from the disabled TTS generation and streamed narration capability under ID 47. | 85 — Desktop/terminal notifications and speech attention cues | ◐ | ◐ |
| ENABLE NARROWED — Keep OMP's self-contained executable build, native-addon compilation/embedding/loading, and packaging substrate for consuming distributions' explicitly supported release targets. Disable OMP's user-facing installer, startup executable-update check and banner, self-update command, direct replacement from upstream OMP binaries, unverified native-Windows claim, and additional distribution channels. Installation, executable updates, platform claims, and artifact verification are owned by each consuming distribution. | 86 — Self-contained cross-platform runtime, native Windows, installer, and self-update | ◐ | ◐ |
| ENABLE — Keep OMP's local usage and statistics dashboards, tracing and profiling, benchmark runners, debug bundles, and garbage-collection commands alongside the provider-usage and model-performance surfaces selected under ID 71. | 87 — Local usage dashboard, traces, benchmarks, debug bundles, and garbage collection | ◐ | ◐ |

OMP evidence: [collaboration](docs/collab.md), [approval routing](docs/approval-mode.md), [marketplace](docs/marketplace.md), [CLI surfaces](packages/coding-agent/src/cli-commands.ts), and [canonical tool list](packages/coding-agent/src/tools/builtin-names.ts).
