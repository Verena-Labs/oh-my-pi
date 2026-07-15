# Plan: Ultra Thinking Tier

## Mode

Source implementation complete; protected delivery pending

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

- The primary agent retains every tool that was active before Ultra was
  selected.
- Ultra adds the orchestration tools to that toolset instead of replacing it.
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
- `ultra_spawn` accepts a self-contained task and optional session name. It does
  not accept a model tier or thinking level.
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
  Agent Hub, and job behavior remain otherwise unchanged.

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

- **Decision**: The primary agent retains its full active toolset.
  **Why**: Ultra is a player-coach workflow; the primary agent remains the most
  informed integrator and verifier.
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

- **Decision**: Delegate and Vibe receive no backward compatibility.
  **Why**: They were never used in this downstream distribution, so compatibility
  would preserve complexity without preserving user data.
  **Status**: confirmed

- **Decision**: `ultra` remains distinct from provider effort names internally.
  **Why**: Providers understand `xhigh`, not the composite orchestration policy;
  the existing `auto` selector demonstrates the same separation.
  **Status**: confirmed

- **Decision**: Keep ordinary visible `xhigh` and Ultra as adjacent, distinct
  choices.
  **Why**: `xhigh` is reasoning-only, while Ultra adds the orchestration policy;
  keeping both lets the user request maximum individual effort without workers.
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
10. **Pending separate delivery authorization** — Protected pull request,
    immutable `pi-v16.5.0-r<n>` publication, and the isolated `pi-dotfiles`
    importer remain outside this source-implementation step.
11. **Pending future group** — Science terminology/release pinning remains
    separate. Do not vendor the engine or begin Group 1 here.

## Validation evidence

- Parser, metadata, selector, status, ACP, persistence, resume, model-change,
  capability-clamping, and ordinary-`xhigh` distinction contracts pass.
- AgentSession contracts prove the primary tool union, player-coach prompt,
  private worker prompt boundary, serialized transitions, rollback behavior,
  transcript cleanup, and `killAll` on exit.
- Runtime and executor contracts prove the single private worker definition,
  direct spawn-time model pinning, descendant root-snapshot inheritance,
  recursive Ultra/xhigh propagation, continued turns, steering, queues, wait,
  owner isolation, cancellation, and result delivery.
- Tool contracts prove exactly five public `ultra_*` tools and strict
  `ultra_spawn` rejection of model, thinking, tier, and named-agent selectors.
- Negative contracts and source searches prove `/delegate`, `delegate_*`,
  `/vibe`, and `vibe_*` are absent from the callable/public compatibility
  surface; historical changelog records and unrelated English remain intact.
- `bun check`, coding-agent typecheck, downstream contracts (89 matrix
  decisions and 60 journeys), downstream tests, native build, coding-agent
  build, CLI help/version, and source plus built-binary smoke all pass with Bun
  1.3.14 and the repository's nightly Rust toolchain.
- An authenticated paid-provider end-to-end session was not run during source
  validation. Its manual journey remains part of protected delivery acceptance.

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

The authorized Group 0 source work ends with this fork implementation and its
verification. A protected PR may carry these changes for review, but immutable
release publication, the `pi-dotfiles` importer, Science release pinning, engine
vendoring, and Group 1 work require their own delivery step.
