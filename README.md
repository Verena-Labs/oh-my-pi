# Pi downstream runtime

This repository is Verena Labs' canonical downstream fork of Oh My Pi (OMP).
It exposes the selected runtime as one public command, `pi`, while retaining
internal `@oh-my-pi/*` package names for compatibility and provenance.

[OH_MY_PI_FEATURE_MATRIX.md](OH_MY_PI_FEATURE_MATRIX.md) is the authoritative
product boundary, and [PI_ACCEPTANCE_TESTS.md](PI_ACCEPTANCE_TESTS.md) is its
shared behavioral acceptance contract. Disabled OMP source may remain in the
fork for clean upstream synchronization, but it is not registered, advertised
by the runtime, or initialized by Pi.

## Runtime and distribution boundaries

- The public executable and completion command are `pi`; no `omp` executable is
  emitted.
- Pi uses one permanent user environment at `~/.pi`, with agent state under
  `~/.pi/agent`.
- Named profiles and alternate permanent config or agent homes are unavailable.
- This fork publishes source-only tags. It does not publish an installer or
  claim platform, architecture, terminal, package-manager, or distribution
  support on a consumer's behalf.
- OMP installers, startup executable-update checks, self-update, and direct
  binary replacement are unavailable. Installation, executable updates,
  artifact verification, supported-target claims, and rollback are owned by
  each consuming distribution.

## Selected capabilities

Pi retains OMP's Pi-compatible core plus the matrix-selected native behavior:

- interactive, one-shot, JSON, RPC, and TypeScript SDK entry points;
- model/provider catalog, custom providers, role routing, Models Hub, usage,
  benchmarks, local tiny models, and request controls;
- rich read/write/edit, archives, SQLite, notebooks, structural summaries,
  hashline and optional fuzzy editing, AST search/codemods, conflict resources,
  artifacts, Obsidian vaults, shell/PTY, LSP, browser, image inspection and
  conditional image generation;
- plan/review, persistent goals and TODOs, typed subagents and durable results,
  Agent Hub, peer messaging, advisor, Ultra orchestration, Ask, jobs, bounded loops,
  supervised processes, prewalk, and YAML workflows;
- project memory plus local, Mnemopi, and Hindsight memory operations;
- ordinary Pi extensions, custom tools/commands, the full plugin marketplace
  manager, and atomic runtime plugin/config reload;
- MCP, checkpoints, rewind, lazy tool discovery, notifications, diagnostics,
  status and full-screen hubs.

The canonical built-in tool set is:

```text
read bash launch edit ast_grep ast_edit ask glob grep lsp inspect_image browser
checkpoint rewind task job irc todo web_search search_tool_bm25 write
memory_edit retain recall reflect learn
```

`learn` is memory-only. Agent-managed skill creation remains unavailable.
Conditional image generation is added only when its configured provider is
available.

Ultra is a composite thinking tier, not a slash-command mode or a model role.
Selecting it keeps the main agent on its current model, requests `xhigh`
reasoning clamped to the highest effort that model supports, preserves
the main agent's complete active toolset, and adds `ultra_spawn`, `ultra_send`,
`ultra_wait`, `ultra_kill`, and `ultra_list`. Ultra is offered only when the
current model exposes controllable reasoning effort. Each direct Ultra worker
snapshots the main agent's current model and clamped effort when spawned through
one generic full-capability worker definition outside the ordinary named
task-agent catalog; every descendant inherits that root snapshot. Existing
worker trees remain pinned to their spawn-time model and effort, while later
direct spawns use the main agent's newly selected model. There is no worker-model
or worker-tier selector. Ordinary `xhigh`
remains a separate reasoning-only selection. The existing Agent Hub,
persistent-session lifecycle, and live multi-worker wall remain the inspection
and control surfaces. `/ultra`, `/delegate`, `/vibe`, `delegate_*`, and
`vibe_*` are not public or compatibility surfaces.

## Narrowed resources and web search

Pi registers exactly these common internal-resource schemes:

```text
local:// agent:// artifact:// history:// mcp:// memory:// skill:// vault://
ssh:// pi://
```

The purpose-built `conflict://` workflow is separate. Pi does not register
`issue://`, `pr://`, `rule://`, legacy `omp://`, or arbitrary host-defined RPC
schemes. `ssh://` provides bounded remote rich-file access through ordinary
file tools; there is no dedicated persistent SSH tool or CLI.

`web_search` is limited to normalized cited results from OpenAI/Codex and
credential-free DuckDuckGo. `auto` chooses the first available selected
provider, and an explicitly enabled fallback stays within that pair. OMP's
broad provider cascade and package, forum, security, and GitHub-filesystem
handlers are unavailable.

The browser tool keeps persistent named Chromium/CDP tabs, ARIA inspection,
screenshots, uploads, navigation/network waits, scripted interaction, and raw
Puppeteer objects. Browser scripts receive only the browser-specific runtime;
they cannot bridge into Pi tools, agents, pipelines, the host filesystem, or
the host environment.

## Intentionally unavailable OMP additions

The matrix's disabled families include:

- automatic subagent worktrees and patch/branch integration;
- `/tan`, agentic Git/commit automation, autoresearch, and CI-green loops;
- persistent Python/JavaScript/Ruby/Julia eval and code-to-tool bridges;
- DAP, dedicated SSH/GitHub tools, speech transcription, TTS generation, and
  mid-stream rule interception;
- managed skill learning, rulebooks, extra compaction/session operations,
  searchable session trees, stop recovery,
  idle recap, and expanded transcript export;
- fallback chains, credential pooling, path-scoped provider policy, remote
  credential broker/gateway, secret obfuscation, and named profiles;
- live collaboration, encrypted snapshot sharing, ACP, and automatic discovery
  of other tools' configuration.

These names also remain reserved across CLI, SDK, RPC, MCP, plugin, custom-tool,
and custom-command boundaries so extensions cannot reactivate them.

## Development

Fresh source checkouts require the Bun workspace and native addon:

```sh
bun install --frozen-lockfile
bun run build:native
bun --cwd=packages/coding-agent run build
```

Useful checks:

```sh
bun run check
bun packages/coding-agent/src/cli.ts --version
bun packages/coding-agent/src/cli.ts --help
node scripts/check-pi-product-docs.mjs
node --test scripts/check-pi-product-docs.test.mjs
node scripts/check-pi-phase4-evidence.mjs
node --test scripts/check-pi-phase4-evidence.test.mjs
```

The development build emits `packages/coding-agent/dist/pi`. A consuming
distribution compiles, packages, hashes, installs, and smokes its own final
artifact from an immutable downstream source tag. Internal npm package names
remain under `@oh-my-pi/*` because they are implementation and provenance
identifiers, not a second public executable.

## Upstream provenance

This repository is downstream of
[can1357/oh-my-pi](https://github.com/can1357/oh-my-pi), which is a fork of Mario
Zechner's [Pi](https://github.com/badlogic/pi-mono). See
[PI_VENDOR.md](PI_VENDOR.md) for the exact upstream provenance and
[PI_FORK.md](PI_FORK.md) for source-tag and upstream-sync policy.

MIT licensed; retain the upstream copyright and license notices in
[LICENSE](LICENSE).
