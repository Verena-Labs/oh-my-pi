# Plan: Ultra Thinking Tier

## Mode

Revision 4 shipped; revision 5 public-role cleanup ready for delivery

## Goal

Replace the public Delegate slash mode with an `ultra` thinking-tier experience.
Selecting Ultra keeps the primary agent fully capable, applies extra-high
reasoning to it, and enables the existing persistent parallel-agent runtime.
Each direct Ultra worker snapshots the primary agent's exact current model and
extra-high reasoning policy, and every descendant inherits that root snapshot.
Existing worker trees remain pinned while later direct spawns follow a main
session model change.

Ultra should feel like the ordinary Pi agent operating at maximum effort with
parallel help, not like a separate director-only product mode.

Revision 3 closes the mismatches found after live use: ordinary named Task
agents must be unavailable while Ultra is active, workers may inherit a bounded
or complete snapshot of useful parent-chat context, the player-coach prompt
must state a stronger delegation boundary, worker provenance and parked/cold
resume state must be visible, and max-capable thinking controls must order
`xhigh`, `max`, `ultra` with a dedicated Ultra symbol.

Revision 4 does not change the Ultra runtime contract. It corrects stale mapped
release tests discovered only when the immutable revision 3 source was imported
into the consumer's complete Phase 4 acceptance suite, then republishes the
same implementation behind a new immutable source identity.

Revision 5 retires the unrelated public `commit` model role that remained in
the picker after its agentic command was disabled. General role routing and
historical role settings cannot restore it. Online title generation now uses
`tiny`, then `smol`, then the current model. Dormant ID 18 implementation source
remains available for upstream maintenance without a public command or role.

## Non-goals

- Do not create another agent runtime, job manager, transcript system, or
  lifecycle manager.
- Do not design a new agent dashboard, wall, selector, or transcript UI.
- Do not retain `fast` and `good` worker tiers or add per-spawn model and
  thinking controls.
- Do not retain `/delegate`, `delegate_*`, Vibe aliases, or compatibility for
  historical Delegate/Vibe sessions.
- Do not change ordinary English/code uses of "delegate" that are unrelated to
  the removed product mode.
- Do not make consumer-specific changes directly in `pi-dotfiles`; engine work
  lands in `Verena-Labs/oh-my-pi` and is consumed from an immutable release.
- Do not begin Science Group 1 runtime, backend, renderer, or UI work.

## Baseline before implementation

- `/delegate` is an exclusive interactive mode. It cannot coexist with Plan or
  Goal mode.
- Entering Delegate stores the active tool list and replaces it with `read` plus
  `delegate_spawn`, `delegate_send`, `delegate_wait`, `delegate_kill`, and
  `delegate_list`.
- The injected Delegate prompt explicitly forbids the primary agent from
  editing, running commands, searching, building, or testing.
- Delegate workers are persistent, owner-scoped sessions with asynchronous
  result delivery, steering, queued follow-ups, waiting, cancellation, parking,
  revival, transcripts, activity traces, and a live TV wall.
- The existing UI already displays each worker's state, model, activity, tool
  trace, and streamed output. Agent Hub and job surfaces use the same underlying
  worker state.
- Delegate exposes `fast` and `good`. `fast` maps to the bundled `sonic` agent
  (`@smol`, normally medium thinking, no nested spawns). `good` maps to the
  bundled `task` agent (`@task`, normally auto thinking, nested spawns allowed).
- Delegate does not accept a thinking level per spawn and does not inherit the
  primary session's current thinking level.
- Pi already has a coding-agent-only `auto` thinking selector that maps to a
  concrete provider effort per turn. This establishes a precedent for a public
  selector whose value is not itself a provider effort.
- The current thinking cycle and status line already render configured and
  effective thinking state. Provider-facing extra-high effort is named
  `xhigh` and is clamped to the highest level supported by the active model.
- Thinking selection is currently synchronous, while changing the active tool
  registry is asynchronous. Ultra activation must reconcile that lifecycle
  without leaving a transient or partially activated state.
- Persistent worker sessions retain the model with which their session was
  created. Moving them to another model mid-conversation is not existing
  Delegate behavior.
- A strong `task` worker may spawn nested agents. Their definitions can normally
  choose different model roles, so an Ultra-wide same-model invariant must be
  propagated recursively rather than applied only to direct workers.
- Ordinary OMP agents are named definitions, not merely model tiers. Their
  Markdown frontmatter can independently select a system prompt, tool allowlist,
  spawn policy, model role, thinking level, blocking behavior, and output schema.
  Ultra intentionally does not select or reinterpret those identities; they
  remain part of the separate ordinary `task` system.

## Desired behavior

### Selection and visible state

- Ultra is selected through the existing thinking-level interaction, not a
  slash command.
- The status/model line displays `ultra` while the composite policy is active.
- Ultra is a coding-agent policy selector. Internally, provider calls receive
  effective `xhigh` reasoning, safely clamped for the active model.
- Selecting another thinking tier exits Ultra, removes the Ultra-only tools and
  prompt, terminates Ultra worker sessions, and applies the newly selected
  thinking level.
- Session persistence and resume must restore either the complete Ultra policy
  or an ordinary thinking level; it must never restore only `xhigh` while
  silently omitting orchestration.

### Primary agent

- The primary agent retains every non-orchestration implementation tool that
  was active before Ultra was selected.
- Ultra temporarily suspends the ordinary named-agent `task` surface and Eval
  `agent()`, then restores their exact prior state on exit.
- Ultra adds its five orchestration tools to the remaining toolset.
- The primary agent continues to inspect, edit, execute, test, integrate,
  commit, and otherwise work normally while workers run.
- The injected prompt encourages proactive delegation only for concrete,
  bounded work that can proceed independently or add useful independent
  verification.
- The primary agent owns the final result, resolves shared-workspace conflicts,
  verifies worker claims, and may personally repair integration problems.

### Worker surface

- The only public orchestration tools are `ultra_spawn`, `ultra_send`,
  `ultra_wait`, `ultra_kill`, and `ultra_list`.
- `ultra_spawn` accepts a task, optional session name, and `fork_turns` choice
  for no parent chat, the latest N user-led turns, or all effective
  post-compaction parent chat. It does not accept a model tier or thinking
  level.
- Every direct Ultra worker uses the primary agent's exact model selector and
  effective `xhigh` reasoning.
- The `fast`/`good` capability split is removed. Every Ultra spawn creates the
  same generic, fully capable Ultra worker; the main agent supplies any
  temporary role or specialty in the assignment text.
- The Ultra worker is not a named/discoverable ordinary task-agent definition,
  and `ultra_spawn` has no ordinary-agent selector. It may reuse the existing
  headless session, registry, and lifecycle plumbing internally without merging
  the two public systems.
- Nested workers inherit the same root Ultra model and extra-high reasoning
  policy, regardless of their ordinary agent definition's model role.
- Spawn, send, live steering, queued follow-up, wait, cancellation, persistent
  conversation, parking, revival, result delivery, transcript, trace, TV wall,
  Agent Hub, and job behavior remain otherwise unchanged. Worker provenance is
  explicit, and addressable Ultra rosters cold-resume only with the same owning
  conversation; explicit kill, Ultra exit, and transcript changes remain
  terminal.

### Removal

- Remove the `/delegate` slash command and every public `delegate_*` tool.
- Remove Delegate mode markers, status strings, prompts, state types, and
  transcript compatibility.
- Remove the inherited `/vibe`, `vibe_*`, and Vibe transcript-renderer aliases.
- Rename internal Delegate-specific runtime symbols and paths where they encode
  the removed product concept. Unrelated delegation terminology remains.

## Decisions

- **Decision**: Ultra is a thinking-tier product policy, not a slash mode.
  **Why**: It presents parallel work as a higher-effort form of the ordinary
  agent rather than a separate director persona.
  **Status**: confirmed

- **Decision**: The primary agent retains its full implementation toolset while
  Ultra replaces competing ordinary named-agent spawn paths.
  **Why**: Ultra is a player-coach workflow; the primary agent remains the most
  informed integrator and verifier, but two overlapping orchestration systems
  make worker identity, context, and model invariants ambiguous.
  **Status**: confirmed

- **Decision**: Ultra uses the existing worker runtime and UI without a new
  agent surface.
  **Why**: Persistence, steering, jobs, Agent Hub, transcripts, traces, and the
  live wall already implement the required experience.
  **Status**: confirmed

- **Decision**: Direct Ultra workers snapshot the primary agent's exact model
  and effective `xhigh` reasoning; nested workers inherit their root snapshot.
  **Why**: Ultra represents more parallel instances of the same high-effort
  agent, not a router among cheap and expensive worker classes.
  **Status**: confirmed

- **Decision**: Ultra spawn exposes no worker model or thinking choice.
  **Why**: The selected Ultra policy determines both consistently and keeps the
  orchestration prompt/tool contract small.
  **Status**: confirmed

- **Decision**: Ultra has one generic, fully capable worker type outside the
  ordinary named-agent `task` system.
  **Why**: This matches the intended player-coach behavior: the main agent
  decomposes work and describes an ad hoc role in each assignment instead of
  routing among durable `scout`, `reviewer`, `designer`, or other profiles.
  Ordinary OMP agents remain available unchanged through `task` outside Ultra.
  **Status**: confirmed

- **Decision**: Ultra workers can inherit `none`, the latest positive number of
  user-led turns, or `all` effective parent-chat context; omitted
  `fork_turns` defaults to `all`.
  **Why**: General same-model workers need the option to share current decisions
  without forcing every assignment to copy the entire conversation or start
  blank.
  **Status**: confirmed

- **Decision**: Ultra worker provenance and owner-scoped roster lifecycle are
  persisted explicitly.
  **Why**: Transcript files alone cannot distinguish Task from Ultra or tell an
  addressable parked worker from an explicitly terminated historical session.
  **Status**: confirmed

- **Decision**: Delegate and Vibe receive no backward compatibility.
  **Why**: They were never used in this downstream distribution, so compatibility
  would preserve complexity without preserving user data.
  **Status**: confirmed

- **Decision**: `ultra` remains distinct from provider effort names internally.
  **Why**: Providers understand `xhigh`, not the composite orchestration policy;
  the existing `auto` selector demonstrates the same separation.
  **Status**: confirmed

- **Decision**: Keep ordinary visible `xhigh`, `max`, and Ultra as distinct
  choices, ordered `xhigh`, `max`, `ultra` when all are supported.
  **Why**: Concrete provider efforts remain ordered before the composite
  orchestration policy; Ultra receives its own symbol so it cannot be mistaken
  for reasoning-only xhigh.
  **Status**: confirmed

- **Decision**: Persistent workers remain pinned to their spawn-time model;
  newly spawned workers use the primary agent's current model.
  **Why**: Silently changing a persistent conversation's model is surprising
  and requires new migration behavior. The existing wall already exposes each
  worker's resolved model.
  **Status**: confirmed

## Open questions

None. Ordinary `xhigh` remains available, persistent worker trees stay pinned
to their root spawn-time model, and later direct spawns use the newly selected
main model.

## Edge cases

- Scenario: The active model supports reasoning but not `xhigh`.
  Expected behavior: Ultra remains coherent and the effective effort clamps to
  the model's highest supported level; no unsupported provider value is sent.

- Scenario: The active model exposes no controllable reasoning effort.
  Expected behavior: Ultra must either be unavailable in the thinking selector
  or refuse activation with a clear explanation; it must not claim xhigh.

- Scenario: Ultra is selected while a normal turn is streaming.
  Expected behavior: activation is atomic from the next safe turn boundary;
  the injected prompt and active tool schema appear together.

- Scenario: The user leaves Ultra while workers are running.
  Expected behavior: in-flight turns are cancelled, all owned Ultra workers are
  terminated, Ultra tools/context disappear, and the prior ordinary toolset is
  retained.

- Scenario: A worker spawns a nested agent whose normal definition points to
  `@smol`, `@slow`, or another model.
  Expected behavior: the Ultra root policy wins; the descendant uses the root
  Ultra model and effective xhigh reasoning.

- Scenario: Ultra is restored from a saved session.
  Expected behavior: thinking display, effective reasoning, tool union, prompt,
  and worker policy restore consistently rather than partially.

- Scenario: A model change occurs while Ultra workers are active.
  Expected behavior: existing worker trees retain their root spawn-time model
  and the wall continues to display it; later direct spawns snapshot the new
  main model.

- Scenario: Ultra activates while `task` was enabled, disabled, or already has
  an ordinary worker running.
  Expected behavior: no new ordinary named-agent spawn path remains callable;
  an existing worker may finish, and exit restores exactly the prior Task
  availability.

- Scenario: A spawn requests `fork_turns` as `none`, a positive integer, or
  `all`.
  Expected behavior: the worker receives exactly the selected effective
  parent-chat range as read-only context, excluding thinking, in-progress spawn
  machinery, and malformed tool protocol. Oversized inheritance fails clearly.

- Scenario: Pi closes while an Ultra worker is idle, parked, or running, then
  resumes the same owning conversation.
  Expected behavior: addressable workers return parked with their Ultra
  provenance and exact model contract; an interrupted turn is not replayed.
  Explicitly killed or cleared workers remain historical and cannot revive.

- Scenario: A max-capable model cycles beyond xhigh.
  Expected behavior: the visible order is xhigh, max, Ultra, and Ultra's symbol
  remains distinct from both reasoning efforts in normal and compact status.

## Implementation status

1. **Complete** — Added the `ultra` configured-thinking sentinel and metadata at
   the coding-agent layer, mapping its effective main-agent effort to
   model-clamped `xhigh`.
2. **Complete** — Integrated Ultra with thinking selectors and cycling, status
   rendering, ACP, session persistence/resume, CLI/config parsing, and model
   changes while keeping ordinary `xhigh` distinct.
3. **Complete** — Replaced the exclusive Delegate mode with a serialized Ultra
   policy lifecycle. Activation adds the five tools to the primary's existing
   toolset; activation/deactivation failures restore coherent thinking,
   persistence, prompt, and tool state.
4. **Complete** — Removed the public Delegate/Vibe commands, tools, prompts,
   state, renderers, and transcript compatibility rather than retaining aliases.
5. **Complete** — Replaced `fast`/`good` selection with one private generic,
   fully capable Ultra worker outside ordinary named-agent discovery. The public
   spawn schema accepts only `prompt` and optional `name` and rejects undeclared
   model, thinking, tier, and agent selectors.
6. **Complete** — Direct workers snapshot the current main model and clamped
   effort; recursive descendants inherit the root worker snapshot until the
   configured recursion boundary.
7. **Complete** — Preserved persistent sessions, async jobs, steering, queued
   follow-ups, wait, kill, transcript/trace, parking/revival, Agent Hub, and the
   live TV wall. Transcript switches and Ultra exit terminate the applicable
   worker roster.
8. **Complete** — Updated the feature matrix, acceptance plan, Phase 4 evidence,
   README, model/settings docs, changelog, and focused runtime/UI contracts.
9. **Complete for source scope** — Ran focused tests, downstream documentation
   contracts/tests, repository type/style checks, native and coding-agent builds,
   source and built-binary CLI smoke, and legacy-surface searches. The broad
   coding-agent suite still contains unrelated Pi-disabled, environment, and
   existing baseline failures; no Ultra-focused assertion failed.
10. **Complete for revision 2** — Carried the initial source through the
    protected pull request, immutable `pi-v16.5.0-r2` publication, and the
    isolated `pi-dotfiles` importer and consumer acceptance gates.
11. **Complete for revision 3 source** — Merged the corrected runtime through
    the protected pull request and published immutable source-only
    `pi-v16.5.0-r3` at merge `c47af4d8f42d77bf5a139406028b07d0d492a81e`.
12. **Authorized plan-only handoff** — After the immutable release and consumer
    mirror exist, update Science terminology and release pinning with their exact
    SHAs. Do not vendor the engine or begin Group 1 here.

### Revision 3 correction status

1. **Complete** — Suspend `task` from the active and discoverable tool
   surfaces during Ultra and deny Eval's named-agent `agent()` helper, with
   exact state restoration and transition rollback.
2. **Complete** — Add strict `fork_turns` context inheritance for none,
   recent N, and all effective post-compaction parent-chat context.
3. **Complete** — Strengthen the main and recursive worker prompts around
   bounded independent workstreams, deliberate context selection, continued
   main-agent work, shared-workspace ownership, result verification, and
   wait/kill discipline.
4. **Complete** — Persist Task/Ultra worker provenance, derive parked state
   from the shared registry, and reconstruct only explicitly addressable Ultra
   rosters when the same owning conversation resumes.
5. **Complete** — Reorder max-capable thinking surfaces to
   `xhigh -> max -> ultra` and add a first-class `thinking.ultra` theme symbol.
6. **Complete** — Ran the focused, downstream, full type/style, native build,
   coding-agent build, source and built CLI smoke, portable-share server, and
   authenticated same-model Ultra journeys with Bun 1.3.14 and the pinned Rust
   nightly.
7. **Complete** — Merged and published immutable source-only
   `pi-v16.5.0-r3` at `c47af4d8f42d77bf5a139406028b07d0d492a81e`.
8. **Complete** — Corrected the stale completion and Ultra tool-activation
   assertions plus the overly broad Eval evidence mapping found by the complete
   consumer Phase 4 run, advance the fork-owned release provenance that r3 left
   stale, publish immutable `pi-v16.5.0-r4`, and hand that exact source identity
   to consumers. Revision 4 carries no runtime change.

### Revision 5 follow-up status

1. **Complete** — Removed `commit` from the public model-role registry and
   general resolution, while preventing stale `modelRoles`, `cycleOrder`, and
   `modelTags` entries from resurrecting it in `/models`.
2. **Complete for source scope** — Changed online title selection to
   `tiny -> smol -> current model` and updated focused runtime, picker, mapped
   evidence, documentation, and release provenance contracts.
3. **In delivery** — Publish immutable source-only
   `pi-v16.5.0-r5`, import that exact source into `pi-dotfiles`, and advance the
   current Science `feature/omp-group-1` vendor baseline and native title route.

## Validation evidence

The evidence below records the completed revision 3 source implementation.
Revision 4 retains those results and adds a clean pass of the corrected complete
consumer-mapped evidence set before delivery.

- Revision 5's focused role/title/picker suite passes 65 tests with nine
  explicitly dormant fallback-chain skips and no failures. The retained
  disabled commit-model test also passes, proving the cleanup did not damage
  dormant source.
- Revision 5's complete mapped Phase 4 run passes all 60 journey obligations,
  34 negative obligations, 12 public-surface classes, and the startup/idle
  instrumentation obligation with Bun 1.3.14. Full TypeScript/Rust checks,
  native and coding-agent builds, CLI smoke, and downstream provenance/docs
  contracts also pass.

- The corrected revision 4 Journey 10 mapping passes 299 tests with 1,236
  expectations, skips only nine explicitly dormant fallback-chain contracts,
  and has no failures across all 27 mapped Ultra files.
- Fork provenance verification, all 16 downstream contract tests, repository
  type/style checks, and the focused completion, activation/restoration, and
  Eval-description corrections pass with Bun 1.3.14.

- Parser, metadata, selector, status, ACP, persistence, resume, model-change,
  capability-clamping, and ordinary-`xhigh` distinction contracts pass.
- AgentSession contracts prove exact suspension and restoration of ordinary
  Task and Eval spawning, the primary tool union, player-coach prompt, private
  worker prompt boundary, serialized transitions, rollback behavior,
  transcript cleanup, and terminal cleanup on Ultra exit.
- Runtime and executor contracts prove the single private worker definition,
  strict `fork_turns` context snapshots, direct spawn-time model pinning,
  descendant root-snapshot inheritance, recursive Ultra/xhigh propagation,
  recursion-ceiling Task exclusion, continued turns, steering, queues, wait,
  owner isolation, cancellation, and result delivery.
- Lifecycle, fork, SDK, export, collaboration, and output-allocation contracts
  prove owner-scoped cold roster restoration, terminal kill/exit behavior,
  revival fencing, early Ultra provenance, safe transcript forks, portable
  exports without local paths, projected collaboration ancestry, and collision-
  free session identifiers across nested and concurrent allocation.
- Selector, browser, status, and theme contracts prove the visible
  `xhigh -> max -> ultra` order and a dedicated Ultra glyph in Unicode, Nerd
  Font, ASCII, compact status, model-browser, and Poimandres surfaces.
- Tool contracts prove exactly five public `ultra_*` tools and strict
  `ultra_spawn` rejection of model, thinking, tier, and named-agent selectors.
- Negative contracts and source searches prove `/delegate`, `delegate_*`,
  `/vibe`, and `vibe_*` are absent from the callable/public compatibility
  surface; historical changelog records and unrelated English remain intact.
- The focused revision 3 matrix passes 82 tests with no failures; the complete
  share/export file passes 9 tests with its local upload server enabled.
- Repository type/style checks, downstream contracts (89 matrix decisions and
  60 journeys), all 16 downstream tests, native build, coding-agent build, CLI
  help/version, and source plus built-binary smoke all pass with Bun 1.3.14 and
  the repository's pinned nightly Rust toolchain.
- The broad upstream-heavy coding-agent sweep was also run. Its existing
  Pi-disabled and environment-dependent failures remain outside the focused
  release surface; no revision 3 focused assertion failed.
- An authenticated no-session journey on `openai-codex/gpt-5.6-luna` proved the
  main agent retained `read`, spawned exactly one same-model Ultra worker with
  `fork_turns: "none"`, continued its own read while the worker ran, waited for
  the result, and returned both synthetic fixture tokens correctly.

## Resolved implementation notes

- The synchronous thinking selector and asynchronous tool registry are joined by
  a serialized prompt-time policy barrier with compensating rollback.
- `ultra` remains a coding-agent sentinel; providers receive only a concrete,
  supported effort.
- Model identity is explicit and inherited from a direct worker's root snapshot,
  not re-resolved through `smol`, `slow`, `task`, or another named role.
- Persistent worker trees remain pinned across main-model changes; later direct
  spawns snapshot the new main model.
- Old Delegate/Vibe transcripts are intentionally unsupported as confirmed.
- Matrix ID 11 and its acceptance/evidence records now describe Ultra.

## Delivery boundary

The authorized delivery step carries the revision 5 cleanup through its
protected PR, immutable source release, `pi-dotfiles` importer and consumer
acceptance, and exact vendoring into Science `feature/omp-group-1`. Unrelated
Science Group 1 implementation remains outside this correction.
