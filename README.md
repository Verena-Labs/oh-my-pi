# Pi vendored runtime

This directory contains the runtime shipped by this repository as one command:
`pi`. It is built from the pinned Oh My Pi (OMP) source snapshot recorded in
[PI_VENDOR.md](PI_VENDOR.md), then narrowed by the replayable downstream patch
series under [`../vendor-patches/omp/`](../vendor-patches/omp/).

The authoritative product boundary is
[`../OH_MY_PI_FEATURE_MATRIX.md`](../OH_MY_PI_FEATURE_MATRIX.md). Disabled OMP
source may remain in this vendored tree for clean upstream replay, but it is not
registered, advertised by the runtime, or initialized by Pi.

## Runtime identity and state

- The public executable and completion command are `pi`; no `omp` executable is
  emitted.
- Pi uses one permanent user environment at `~/.pi`, with agent state under
  `~/.pi/agent`.
- Named profiles and alternate permanent config or agent homes are unavailable.
- Installation and updates are owned by the parent `pi-dotfiles` repository.
  OMP installers, startup update checks, self-update, and direct binary
  replacement are unavailable.
- This personal release advertises `darwin-arm64` in an
  `xterm-256color`-compatible PTY. Other cross-build code remains replayable
  substrate, not a support claim.

This branch is still in the staged reset workflow described by
[`../plan.md`](../plan.md); it does not yet define the final Phase 5 installer.

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
  Agent Hub, peer messaging, advisor, Delegate Mode, Ask, jobs, bounded loops,
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
bun scripts/ci-release-build-binaries.ts --targets darwin-arm64
```

Useful checks:

```sh
bun run check
bun packages/coding-agent/src/cli.ts --version
bun packages/coding-agent/src/cli.ts --help
```

The development build emits `packages/coding-agent/dist/pi`; the supported
release pipeline emits `packages/coding-agent/binaries/pi-darwin-arm64` for the
parent installer to expose as `pi`. Internal npm package names remain under
`@oh-my-pi/*` because they are implementation and provenance identifiers, not
a second public executable.

## Upstream provenance

OMP is a fork of Mario Zechner's
[Pi](https://github.com/badlogic/pi-mono). The pinned upstream OMP repository is
[can1357/oh-my-pi](https://github.com/can1357/oh-my-pi). See
[PI_VENDOR.md](PI_VENDOR.md) for the immutable release, commit, patch order,
oracle build, and update procedure used by this downstream distribution.

MIT licensed; retain the upstream copyright and license notices in
[LICENSE](LICENSE).
