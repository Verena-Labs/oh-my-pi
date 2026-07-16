# Pi Acceptance Tests

Last reviewed: 2026-07-15

This is the shared behavioral acceptance contract for the Verena Labs
downstream Oh My Pi (OMP) runtime exposed as `pi`. It describes observable
engine behavior, not implementation status. A command existing, a module
loading, or a unit test passing does not count unless the complete user journey
works. Consuming distributions add their own platform, installer, update,
artifact, and rollback gates around this contract.

[OH_MY_PI_FEATURE_MATRIX.md](OH_MY_PI_FEATURE_MATRIX.md) is authoritative for
scope. Every `ENABLE` or `ENABLE NARROWED` row needs positive acceptance
coverage here; every `DISABLE` or `BASELINE ONLY` row is part of the negative
contract below. Disabled source may remain in the fork as long as it is
unreachable and inert.

## Test rules

- Run the downstream candidate and the pinned upstream OMP base in equivalent real PTYs, with the
  same terminal dimensions, model fixture, settings, and disposable project.
  OMP is the interaction oracle except for `omp` -> `pi` branding, deliberately
  disabled surfaces, and explicitly narrowed matrix rows.
- Capture terminal recordings or screenshots for interactive journeys. A
  semantic assertion alone is insufficient when completion, focus, layout,
  cancellation, or resume behavior is part of the feature.
- Use deterministic model/provider fixtures for CI. Repeat the critical paths
  with a real supported model before cutover.
- Record each journey as `PASS`, `FAIL`, or `BLOCKED`, with the downstream
  candidate commit, upstream OMP pin, platform, terminal, model/provider,
  prerequisites, and evidence.
- An honest dependency-unavailable message passes only the unavailable branch.
  It does not pass the feature's successful branch.
- Paid, credentialed, network, and remote-service tests require explicit opt-in.
  Fixture-backed success coverage is still mandatory before release.

## Isolated development state

Until cutover, do not point the candidate or the OMP oracle at live state. Give
each executable a separate temporary home, XDG roots, and disposable project:

```bash
REAL_HOME="$HOME"
PI_TEST_HOME="$(mktemp -d "${TMPDIR:-/tmp}/pi-acceptance.XXXXXX")"
OMP_TEST_HOME="$(mktemp -d "${TMPDIR:-/tmp}/omp-oracle.XXXXXX")"
PI_CANDIDATE="/absolute/path/to/candidate/pi"
OMP_ORACLE="/absolute/path/to/verified/omp-3047c27c33"

prepare_isolated_home() {
  root="$1"
  config_name="$2"
  mkdir -p "$root/config" "$root/state" "$root/cache" "$root/data" \
    "$root/tmp" "$root/work" "$root/$config_name/agent"
  env -i \
    HOME="$root" \
    PATH="$PATH" \
    LANG="${LANG:-C.UTF-8}" \
    git -C "$root/work" init
}

prepare_isolated_home "$PI_TEST_HOME" ".pi"
prepare_isolated_home "$OMP_TEST_HOME" ".omp"

run_isolated() (
  root="$1"
  config_name="$2"
  executable="$3"
  shift 3
  cd "$root/work"
  env -i \
    HOME="$root" \
    PATH="$PATH" \
    SHELL="${SHELL:-/bin/sh}" \
    TERM="${TERM:-xterm-256color}" \
    LANG="${LANG:-C.UTF-8}" \
    USER="${USER:-pi-test}" \
    PI_CONFIG_DIR="$config_name" \
    PI_CODING_AGENT_DIR="$root/$config_name/agent" \
    XDG_CONFIG_HOME="$root/config" \
    XDG_STATE_HOME="$root/state" \
    XDG_CACHE_HOME="$root/cache" \
    XDG_DATA_HOME="$root/data" \
    TMPDIR="$root/tmp" \
    "$executable" "$@"
)

run_pi() { run_isolated "$PI_TEST_HOME" ".pi" "$PI_CANDIDATE" "$@"; }
run_omp() { run_isolated "$OMP_TEST_HOME" ".omp" "$OMP_ORACLE" "$@"; }

run_pi
```

Build the candidate from this checkout and set `PI_CANDIDATE` to the resulting
`packages/coding-agent/dist/pi` executable. A consuming distribution may wrap
these helpers in its own candidate runner, but that runner must preserve the
same isolation boundary and must not silently substitute an installed `pi`.

The harness must snapshot the real `~/.pi` before and after the run and prove
that its files and metadata were not changed. Do not copy the user's whole
state tree into the temporary home. Stage only a minimal disposable fixture or
an explicitly approved credential for a conditional test. System keychain use
must also be disabled or explicitly opted into. The empty starting environment
prevents inherited `PI_*`, `OMP_*`, credential, worktree, cache, and broker
overrides from escaping the sandbox; add only the exact variables required by
an explicitly opted-in conditional test. `PI_CANDIDATE` must resolve to the
staged build under test; using the currently installed `pi` from `PATH` does
not test the candidate and is forbidden here. Stage equivalent fixture files,
settings, and model responses in the two disposable homes, but never share
their state directories.

### Oracle provenance

`OMP_ORACLE` must be a reproducible build from a clean Git checkout at commit
`3047c27c332c5629c8e063283d349384c10c9a56` (OMP `v16.5.0`), using its lockfile
and supported Bun version. Before recording comparison evidence, capture:

- `git rev-parse HEAD` and a clean `git diff --quiet` result from the oracle
  checkout;
- the build command, Bun version, platform, and architecture; and
- a SHA-256 digest of the exact oracle executable.

This fork records its upstream provenance in `PI_VENDOR.md` and differs from the
pristine oracle by design. Independently clone and verify the recorded upstream
commit before building an oracle. Run that executable only through `run_omp`;
never compare against an unpinned global `omp` command.

## Acceptance-blocking first canary: native plan and Ask flow

This journey is run first. Do not expand the downstream delta or claim parity until it
passes against the pinned OMP base.

### 1. Completion and one-step prompt submission

1. Launch the candidate with `run_pi` and the verified oracle with `run_omp` in
   equivalent real PTYs at least 120 columns wide. The helpers provide separate
   clean homes and disposable Git repositories.
2. Type the literal text `/pl` without pressing Enter.
3. Verify the completion row offers `/plan [prompt]` and reports the native
   dynamic state (`Plan: off` in a clean session). It must not advertise Pi
   Suite's `start`, `status`, `approve`, `refine`, `cancel`, or `complete`
   subcommands.
4. Complete and submit this exact command:

   ```text
   /plan this is just a test
   ```

5. One Enter must both enable plan mode and submit `this is just a test` as the
   first planning turn. Requiring a second command or merely printing a
   `Plan: planning` status is a failure.

### 2. Rich Ask interaction

For the deterministic run, make the first model turn call `ask` with this
logical payload:

```json
{
  "questions": [
    {
      "id": "test-target",
      "question": "What would you like to test?",
      "options": [
        { "label": "Plan workflow", "description": "Produce and review an implementation plan." },
        { "label": "Repository inspection", "description": "Investigate the repository without editing." },
        { "label": "Tool behavior", "description": "Exercise a named tool or workflow." }
      ],
      "recommended": 0
    }
  ]
}
```

The pass condition is OMP's rich Ask dialog, not a sequence of generic
selectors. It must show the question, descriptions, recommended choice,
keyboard help, and `Other`/free-text path in one stable interactive surface;
cursor movement, notes, selection, and Esc cancellation must render without
leaving stale UI. The completed Ask tool card stays legible in the transcript,
and the answer returns to the same planning turn exactly once.

Cancel the first Ask with Esc and verify that the tool turn aborts cleanly while
plan mode remains active. Re-run it, choose `Plan workflow`, and continue.

### 3. Read-only planning, review, cancellation, and resume

1. Let the model inspect the disposable repository, ask any remaining
   preference questions, and write its canonical `local://<slug>-plan.md`.
   Hash the working tree before and after: planning may change session-local
   artifacts, but it must not change, delete, or rename working-tree files.
2. When the model submits the plan, verify a full plan-review overlay appears.
   At a sufficient width it must preserve OMP's plan body/section navigation,
   focus and scrolling, annotations/refinement feedback, copy/edit affordances,
   and these actions:

   - `Approve and execute`
   - `Approve and compact context`
   - `Approve and keep context` (including context usage when available)
   - `Refine plan`

   When more than one role model is configured, the native execution-model
   selector must also work.
3. Press Esc. The overlay closes without approving, deleting, or leaving plan
   mode. Run `/plan-review`; the same durable plan reopens.
4. Exit the process while plan mode is active, then resume that exact session
   through the same sandbox with `run_pi --resume <session-id>`. Plan mode, its
   plan artifact, model/tool
   restrictions, and `/plan-review` availability must be restored.
5. In a separate branch of the test, invoke `/plan` while a draft exists.
   Declining the exit confirmation keeps planning active. Confirming exits
   without approval but preserves the draft; a prompted `/plan <prompt>` can
   re-enter planning without corrupting it.

### 4. Refinement and approval

Choose `Refine plan`, provide an annotation or follow-up, and verify the model
updates the same plan before review reopens. Then choose `Approve and execute`.
Plan mode must exit, the execution toolset must be restored, the approved plan
must be supplied to the execution turn, and only then may working-tree writes
occur. The selected execution model must be honored without losing the plan.

Run independent branches for `Approve and compact context` and `Approve and
keep context`. Compare conversation retention, plan reference, model
transition, queued input, cancellation, and error handling to the pinned OMP
base. No approval path may double-submit or strand the session in plan mode.

## Selected capability journeys

The first canary above is the detailed form of journey 1. The remaining rows
state the minimum observable contract; use native OMP commands and UI rather
than recreating old Pi Suite mechanics.

| # | Matrix | Observable pass condition | Prerequisites and boundaries |
|---:|:---:|---|---|
| 1 | 01 | The complete plan/Ask/review/refine/cancel/resume/approve canary passes, and a configured `plan` role actually drives planning while the chosen execution role drives implementation. | Real PTY; deterministic and real model runs. |
| 2 | 02 | A guided goal gathers its objective, persists across turns and session resume, exposes budget/progress, auto-continues when appropriate, and stops on pause, completion, cancellation, or budget exhaustion. | Use a tiny disposable objective; test every advertised budget type. |
| 3 | 03 | Two differently typed subagents start concurrently, stream independent progress, accept steering, finish with distinct results, and remain inspectable. | A multi-call model fixture is required. Matrix row 04 forbids automatic worktree/patch integration. |
| 4 | 05 | Agent-definition, inherited parent-session, and explicit ad-hoc eval schemas each validate incremental and final yield/report submissions through their native paths. Every subagent exposes its complete durable `agent://` result, including supported JSON extraction, while agents without a schema return ordinary text and non-isolated agents remain steerable and resumable. | Exercise successful and invalid structured results plus an unstructured agent. Validation recovery must be bounded; manual isolation keeps its terminal lifecycle, and automatic worktree isolation remains absent under ID 04. |
| 5 | 06 | Agent Hub accurately renders running and completed agents and can inspect, steer, pause, resume, park, revive, and kill them; invalid transitions fail clearly. | Real TUI plus headless/status coverage. |
| 6 | 07 | Peers can list one another, send direct and broadcast messages, correlate awaited replies, persist inbox consumption, and wake a parked recipient without losing messages. | No external IRC server or rooms are implied. |
| 7 | 08 | The advisor/watchdog uses its configured independent model, observes transcript deltas, emits deduplicated evidence-backed findings, and honors its exact configured tool allowlist without gaining undeclared capabilities. | Requires at least two observable turns, a configured advisor role, and separate read-only and explicitly tool-enabled fixtures. |
| 8 | 09 | Independent reviewers run in parallel and return typed P0-P3 findings with evidence, confidence, disagreements, and a deterministic ship verdict. | Use a proposal with deliberate security and correctness flaws. |
| 9 | 10 | `/btw` produces one current-context, no-tools answer without adding a normal conversation turn. | `/tan`, background tangent forks, and their completion/help entries must be absent. |
| 10 | 11 | For a model with controllable reasoning effort, selecting the Ultra composite thinking tier leaves the main agent on its current model, requests `xhigh` clamped to that model's highest supported effort, preserves its normal implementation tools, suspends the ordinary `task` tool plus Eval's named-agent `agent()` helper, and adds exactly the five `ultra_*` orchestration tools. Each direct Ultra worker snapshots the main model and resolved effort through one generic full-capability worker definition, and every descendant inherits that root snapshot. `ultra_spawn` accepts a strict `fork_turns` choice for no parent chat, the latest N user-led turns, or all effective post-compaction parent chat. Sessions continue and steer, queue follow-ups safely, wait/cancel, remain owner-isolated, park and cold-resume without reviving explicitly terminated workers, and render stable state plus distinct Ultra/Task provenance in the existing wall and Agent Hub. Max-capable thinking controls order `xhigh`, `max`, `ultra`, and Ultra uses a dedicated theme symbol. | Enter and leave Ultra through every existing thinking-level control and session-resume path. Prove `task`, tool discovery, stale direct Task invocation, and Eval `agent()` cannot spawn an ordinary named agent during Ultra, then restore exactly to their prior state on exit and rollback failures. Exercise default/all/none/N context inheritance, malformed ranges, compaction, tool-result boundaries, oversized context, attachments, continued turns, multiple concurrent workers, a main-model change, nested inheritance, viewport changes, parking, process-style cold resume, explicit kill, interruption, worker death, and cleanup on Ultra exit or transcript change. Prove lower reasoning ceilings clamp consistently and models without controllable effort omit Ultra. The spawn schema has no tier, model, CLI, or named-agent selector. `/ultra`, `/delegate`, `/vibe`, `delegate_*`, and `vibe_*` remain absent. Ordinary `xhigh`, `max`, `slow`, and named `task` agents remain behaviorally distinct outside Ultra. |
| 11 | 12 | Standalone lowercase `ultrathink`, `orchestrate`, and `workflowz` in ordinary prose receive their native editor highlighting and inject exactly one hidden notice that requests maximum automatic thinking, multi-agent orchestration, or a deterministic task workflow respectively, without replacing or displaying as part of the user's prompt. | Exercise global and per-keyword settings, queued and skill-expanded prompts, and both task batch modes. Substrings, different casing, code blocks, inline code, and XML/HTML regions must not trigger; `workflowz` requires the active task tool, and `ultrathink` must not select the persistent Ultra tier or activate `ultra_*`. |
| 12 | 13 | Phased TODOs have stable IDs and state visible to user and agent, and survive more turns, compaction, branching reconstruction, and session resume. | Use at least two phases and interrupted work. |
| 13 | 14 | A suitable long command becomes a managed background job; list, logs, wait, completion, cancellation, and failure status all remain usable after the originating turn. | Test thresholds with a deterministic local process, not a paid model call. |
| 14 | 15 | Rich Ask supports single-select, multiselect, recommendations, descriptions, notes, `Other`/free text, multi-question navigation, answer preservation, submit, timeout policy, and cancellation. | Interactive-only behavior must be absent or fail explicitly in headless mode; plan-mode Ask must not time out. |
| 15 | 16 | Under an explicitly configured non-yolo policy, read/write/exec classes and per-tool overrides produce the correct allow/ask/deny decision; once/session/persistent grants have the advertised lifetime. | Include an unknown tool and a critical command; default-yolo behavior is not evidence for this journey. |
| 16 | 17a | A count-bounded loop submits exactly the requested settled iterations; a duration-bounded loop respects its deadline; status and explicit cancellation stop future turns. | Each iteration must be a real model turn. |
| 17 | 17b | Fast/priority mode maps to the supported provider's lower-latency service tier without changing the selected model and clears cleanly. | Verify the outbound request with a capture fixture; unsupported providers must report unavailability, not pretend success. |
| 18 | 17c | Requiring a named active tool forces that tool on the next model request, leaves arguments model-selected, and clears after one request or explicit cancellation. | Exercise both a compatible and an incompatible model API. |
| 19 | 19 | A named supervised process supports readiness, reusable bounded logs, PTY/stdin, signals, status, restart generations, stop, project sharing, and lifecycle cleanup. | Use a local fixture process and prove child cleanup after abort/exit. |
| 20 | 20 | Prewalk lets the strong role investigate and produce plan/TODO context, then performs exactly one configured handoff on the first successful write/edit; reads and failed writes do not trigger it. | Configure visibly different planning and fast roles. |
| 21 | 21 | A YAML workflow runs sequential, parallel, and dependency-graph jobs with per-agent roles/models, schema validation, repeats, persisted status/logs, resume, and rerun. | Validate malformed YAML, cycles, failed dependencies, and interrupted resume. |
| 22 | 24 | One unified `read` surface correctly handles local text and directories, images, `.doc`/`.docx`, `.ppt`/`.pptx`, `.xls`/`.xlsx`, PDF, RTF, EPUB, tar/tgz/zip entries, read-only SQLite browsing and queries, editable notebook text, web URLs, SSH-backed resources, and every internal-resource scheme enabled under ID 31, with accurate pagination, metadata, limits, and clear format-specific errors. | Use bounded local document, archive, database, notebook, HTTP, and SSH fixtures; verify archive traversal protection, SQLite read-only behavior, URL caching/redirects, binary and size limits, and cleanup. Structural selectors and protocol registration are tested under IDs 26 and 31 rather than implied here. |
| 23 | 25 | The native write/edit surfaces can create and replace tar/tgz/zip entries, insert/update/delete rows in an existing SQLite database, write through every enabled writable internal-resource handler, and round-trip cell-marked notebook edits into valid `.ipynb` JSON while preserving applicable cell and notebook metadata. | Use disposable fixtures and approval enforcement. Verify archive traversal rejection and whole-archive integrity, SQLite column/key validation and read-only separation, notebook marker validation, interruption/failure behavior, and cache invalidation; Office/PDF/EPUB formats remain read-only because OMP has no structural writer for them. |
| 24 | 26 | Eligible code and prose receive deterministic structural summaries with accurate elision metadata and concrete reread ranges. Explicit-selector and path-suffix forms produce identical single, open-ended, counted, merged multi-range, and raw reads without mistaking literal colon-containing paths for selectors; format-specific archive, SQLite, converted-document, URL, internal-resource, notebook, PDF-image, and `agent://` extraction paths remain coherent with the unified reader. | Exercise summary size/line guards, cache invalidation, malformed and zero-based selectors, range context, truncation, immutable resources, and literal filename precedence. Do not test nonexistent page, cell, JSONPath, XPath, or symbol syntax; conflict resources belong to ID 30. |
| 25 | 27 | Eligible mutable output from `read`, grep, and AST search carries a content-derived snapshot tag and stable line anchors. Hashline `SWAP`, `DEL`, and positional `INS` operations apply to the intended content, exact stale-target recovery preserves unrelated external changes, ambiguous or incompatible stale edits fail with useful context, and every successful edit returns a fresh tag that supports the next edit without rereading. | Exercise external and same-session changes, unknown/expired tags, multiple files, moved/deleted targets, block replacement, repeated byte-identical no-ops, and interruption. Raw, immutable, virtual, unreadable, and over-limit sources must fall back without pretending to provide editable anchors. |
| 26 | 28 | With fuzzy matching enabled, alternate patch/replace modes accept one sufficiently high-confidence unique or dominant content match, report the strategy and confidence, preserve unrelated text, and reject ambiguous or below-threshold candidates; disabling the setting restores exact-only behavior. Every write/edit mode blocks recognized generated files and lockfiles with actionable source-oriented guidance. | Use close competing candidates, configurable thresholds, Unicode/indentation variation, and strong/weak generated markers. Hashline remains exact, ordinary source files must not false-positive, and no failed or ambiguous operation may mutate disk. |
| 27 | 29 | Structural search exposes metavariables; a codemod preview changes nothing until applied; apply writes the exact preview; discard and stale-preview detection leave the file untouched. | Requires the selected AST engine; use disposable source files. |
| 28 | 30 | Reading a conflicted file registers stable `conflict://` resources for every two-way and diff3 block; complete and scoped `ours`/`theirs`/`base` reads are accurate; targeted and bulk writes support literal resolutions plus `@ours`, `@theirs`, `@base`, and `@both`, replace only the selected marker blocks, preserve surrounding content, reject stale registrations, and return fresh hashline snapshots. | Exercise several files, mixed two-way/diff3 conflicts, per-ID bulk directives, partial failures, repeated resolution, malformed markers/scopes, and missing bases. Bulk work must not resolve an unlisted conflict or silently invent merge content. |
| 29 | 31 | Registration, help, completion, direct resolution, and reconstruction expose exactly `local://`, `agent://`, `artifact://`, `history://`, `mcp://`, `memory://`, `skill://`, `vault://`, `ssh://`, and `pi://`; each resolves through its selected owning feature with correct read/write, mutability, pagination, completion, project/session boundary, and unavailable behavior. `issue://`, `pr://`, `rule://`, `omp://`, arbitrary RPC/host-defined schemes, and every other protocol are unknown and inert. | Exercise startup, legacy config, resumed sessions, nested/parked agents, extension reload, handler failure, and every retained protocol with local fixtures before opt-in SSH/Obsidian use. `pi://` must contain branded embedded Pi documentation; `conflict://` remains independently owned by ID 30. |
| 30 | 32 | With vault integration explicitly enabled and the Obsidian CLI available, `vault://` discovers configured and active vaults, safely browses/reads/writes contained files, and executes advertised backlinks, tags, tasks, history, template, search, property, and vault operations with accurate output. Disabled integration or a missing CLI fails clearly without touching the vault. | Use a disposable real vault and CLI fixture before opt-in testing against a user vault. Prove traversal and symlink escape rejection, active/named-vault selection, spaces/encoding, cancellation/timeouts, cache invalidation, and confinement of every write. |
| 31 | 33 | Fast regex, glob, list/tree search find known fixtures, respect ignore/boundary rules, return useful truncation, and remain available through ordinary agent use. | Baseline local journey. |
| 32 | 34 | Shell execution supports ordinary commands and a real persistent PTY with stdin, resize, interruption, output continuity, exit status, and process-tree cleanup on every advertised platform. | Platform-specific native dependencies must be tested on each supported release target. |
| 33 | 35 | Every supported tool-output path that exceeds its advertised inline/display limit preserves the complete sanitized result in the owning session artifact store, reports accurate shown/total/truncation metadata, and returns a working `artifact://` reference whose content can be paged and searched without rerunning the tool. | Exercise text, structured, binary-adjacent, interrupted, failed, non-persistent, resumed, and nested-agent cases. Verify secret sanitization, exact byte/line boundaries, missing-save fallback, session isolation, cleanup, and retention of the `artifact://` handler under deferred ID 31. |
| 34 | 38 | One persistent LSP session can report capabilities/diagnostics and perform navigation, symbols, references, rename previews/applies, code actions, formatting, file renames, and raw requests without escaping the project. | Start real representative servers; missing optional servers may report unavailable but do not pass their success paths. |
| 35 | 40 | Persistent named browser tabs support launch/CDP attach, ARIA inspection, screenshots, uploads, scripted interaction, navigation/network waits, raw Puppeteer, reuse, and clean close. | Requires a supported Chromium. Disconnecting an attached user-owned target must not close it. |
| 36 | 41 | One `web_search` surface returns normalized cited results through the user-selected default; native Codex/OpenAI and credential-free DuckDuckGo paths work, and fallback occurs only when explicitly enabled. | Use network fixtures plus an opt-in live test. The broad auto cascade and package/forum/security handlers must be absent. |
| 37 | 44 | Reading a local image gives the model the image content and produces a grounded description without a duplicate inspection tool. | Use a fixture whose answer cannot be inferred from its filename. |
| 38 | 45 | With an explicitly selected authenticated provider, image generation produces a valid durable local artifact and editing changes the supplied local image as requested; invalid inputs and provider failures are terminal and clear. | May cost money. Test selection ambiguity and prove there is no silent provider retry unless the matrix later enables it. |
| 39 | 48 | A named checkpoint can rewind later conversation context while retaining the operator's report and remaining inspectable after the operation. | Files, Git, processes, artifacts, and external state must remain exactly as they were immediately before rewind. |
| 40 | 49 | BM25 discovery finds a relevant hidden tool, activates it under each supported mode, persists the selection through reconstruction, and resets it without hiding essential tools. | Search public tool metadata only; test catalog invalidation. |
| 41 | 50 | MCP stdio, Streamable HTTP, and SSE fixtures expose tools, resources/templates, prompts, pagination, notifications/list changes, reconnect, and OAuth without one server failure taking down the rest. | Use local protocol and OAuth fixtures before optional live servers. |
| 42 | 52 | Native clipboard operations copy text and import clipboard images safely; syntax highlighting preserves exact underlying content; terminal image detection selects supported Kitty/iTerm2/SIXEL behavior or a clean textual fallback; SIXEL output survives streaming sanitation; and process primitives inspect and terminate complete child trees without collateral processes. Isolation primitives accurately report and execute only when invoked by a separately enabled feature. | Use platform and terminal fixtures for macOS, Linux, and supported release targets, including unavailable clipboard/image protocols, large images, malformed escape streams, nested process trees, cancellation, and cleanup. ID 52 must not reactivate automatic worktree isolation disabled by ID 04. |
| 43 | 53 | Configurable stream guards interrupt repeated reasoning/prose and excessive planning-without-action loops with one corrective redirect; the cross-turn guard detects repeated identical tool calls at its configured threshold while honoring exemptions; and fabricated tool-result markers terminate or drain the provider stream according to policy while preserving real calls and discarding every fabricated result and dependent continuation. | Use deterministic stream fixtures, near-duplicate non-loops, exempt and non-exempt tools, threshold changes, provider abort/drain modes, cancellation, and bounded retry behavior. This journey must not invoke the unexpected-stop classifier or continuation disabled under ID 63; adaptive job polling is covered by ID 14. |
| 44 | 54 | A durable project fact is extracted, consolidated once, injected only when relevant, survives compaction/resume, and can be inspected/flushed without duplicate growth. | Use a temporary memory store and verify no cross-project leakage. |
| 45 | 55 | `retain`, `recall`, `reflect`, and `learn` round-trip through the selected Mnemopi/Hindsight backend with correct project/bank isolation and bounded failure behavior. | Requires local service fixtures and separately opt-in live services; an unavailable server is not a successful feature test. |
| 46 | 62 | Submitted prompts persist in Pi's separate SQLite/FTS5 history database, and Ctrl-R opens a searchable picker whose selected result returns to the editor without enabling the rich session tree. | Exercise persistence across sessions, prefix and infix search, malformed-query fallback, schema migration, secret-bearing command exclusions, keyboard navigation, selection, and cancellation. Session-tree filtering and cross-project resume remain absent under ID 61. |
| 47 | 65 | The full pinned 61-descriptor provider catalog is discoverable with accurate capabilities and auth requirements, and representative subscription, API-key, and local-runtime providers can complete requests. | Transport-specific providers need fixtures or credentials; catalog visibility alone is insufficient. |
| 48 | 66 | Strict YAML provider definitions validate atomically, resolve supported credential sources, implement each enabled API protocol, and discover bounded local/proxy model catalogs; reload cannot leave partial state. | Use fake model-list endpoints and prove unsafe URLs or literal-secret policy violations fail closed. |
| 49 | 67 | Features and agents resolve configured roles such as default, smol, slow, plan, vision, designer, tiny, task, and advisor without hard-coded model IDs; new work adopts changes while an active turn remains stable. The retired `commit` role remains absent from the picker and general routing even when historical settings mention it, while online titles resolve `tiny`, then `smol`, then the current model. | Use distinguishable fixture models. Role routing is separate from the provider fast/service tier, and Ultra must not appear as a model role or change the independently assigned `slow` model. Dormant source for the disabled ID 18 workflow is not a public role. |
| 50 | 71 | `/models` preserves OMP's native model/provider/role workflow and shows catalog pricing plus recorded TTFT/TPS. `/usage` and `pi usage` report only provider-supported limits/history. `pi bench` runs only when explicitly invoked, obeys `--runs` and `--max-tokens`, reports TTFT/TPS, and is interruptible. | Use provider-limit fixtures before opt-in live usage. Benchmark calls may cost money; fallback-chain editing and a legacy `/model-hub` command must be absent. |
| 51 | 72 | The bundled tiny model runs locally for routing/classification, titles, memory work, and selected lightweight background tasks, with deterministic offline behavior and no provider call. | Test cached weights and the explicit download/remove lifecycle; no surprise network access is allowed. |
| 52 | 74 | Session and global service tier, sampling, reasoning effort, verbosity, and provider-specific controls map exactly to supported outbound fields, persist at the advertised scope, and clear cleanly. For models with controllable effort, Ultra persists as a configured session thinking selection while its main and worker requests use the unchanged active model with `xhigh` clamped to its highest supported effort; selecting ordinary `xhigh` resolves the same way without activating orchestration. | Capture main and worker requests for models whose maximum efforts are `xhigh` and lower, and prove no provider receives `ultra`. Ultra is not accepted as a model-selector or role-value suffix and is unavailable when reasoning effort is not controllable. |
| 53 | 77 | Normal Pi extensions load through legacy `pi.extensions` manifests, historical package scopes, configured files/packages, and symlinked directories, while OMP-native plugins and Claude-compatible marketplace catalogs support user/project install, enable, disable, upgrade, uninstall, and every advertised plugin content type. The `off`, `notify`, and `auto` marketplace-update modes perform exactly their stated lifecycle. | Use local extensions plus local Git and HTTP catalog fixtures. Marketplace npm sources must fail explicitly as unsupported; no test may depend on a public marketplace or silently update unrelated user state. |
| 54 | 78 | Reloading an enabled extension, plugin, or supported configuration source atomically adopts changed commands, tools, hooks, providers, and settings in the active process; disabling or uninstalling removes its registrations, while an invalid reload preserves the last known-good runtime without duplicate handlers or leaked watchers. | Exercise real file changes and repeated reloads in disposable state, including an active session and a deliberately broken update. |
| 55 | 82 | The status line renders every configured supported segment accurately across minimal, default, full, and custom presets; adapts deterministically to narrow and wide terminals; and applies separators, transparency, session accents, compact thinking, and colorblind presentation without corrupting the editor or transcript. | Use fixture Git, LSP, agent, job, usage, PR, and timing data. A segment that is absent from the active preset must not perform its background query merely to remain hidden. |
| 56 | 83 | Model, agent, plugin, job, tool, and context hubs open through their advertised keyboard and mouse paths, remain navigable at supported viewport sizes, mutate only their owned state, and immediately reflect install/reload/model/agent/job/tool changes. | Assert that hubs enumerate only actually registered capabilities; a hub must not make a disabled built-in handler reachable or disguise an unavailable operation as successful. |
| 57 | 84 | Generated bash, zsh, and fish completion scripts target `pi`, complete current static and dynamic model/session values, survive spaces and shell quoting, and omit `omp`, profiles, alternate homes, disabled commands, and stale entries after reload. | Run each completion script in its real shell against disposable state. Dynamic completion must be bounded and must not make an unrelated provider or network request. |
| 58 | 85 | Desktop notifications, terminal attention, and speech cues fire only for their configured events and focus/terminal conditions, preserve quiet/off behavior, and degrade safely when the host notifier or speech facility is unavailable. | Use notifier/speech capture fixtures rather than producing real alerts during automated tests. Confirm that ID 85 does not register the ID 47 TTS tool or streamed narration path. |
| 59 | 86 | A clean build produces the single public `pi` executable with its required native addon and assets embedded or versioned correctly, and the artifact starts without a source checkout. No `omp` executable, OMP installer, executable-update banner/check, self-update command, upstream binary replacement, or source-fork platform claim is exposed. | Build from the exact downstream source commit or immutable source tag and smoke it in disposable state. Consuming distributions own target claims, final artifact inspection, installation, upgrades, and rollback; invoking legacy OMP update paths must fail inertly. |
| 60 | 87 | Usage/statistics dashboards, traces, profiling, benchmark runners, debug bundles, and garbage-collection commands run only when configured or explicitly invoked, report accurate bounded data, redact credentials and sensitive request content, handle interruption, and leave unrelated sessions/artifacts untouched. | Use deterministic local fixtures and dry-run/destructive-confirmation checks where available. Paid benchmarks and provider calls require explicit opt-in; debug output must be inspected for secret leakage. |

## Negative-surface and inertness contract

Generate the negative manifest directly from every current `DISABLE`,
`BASELINE ONLY`, and disabled portion of an `ENABLE NARROWED` matrix row. For
each item, prove all of the following:

1. **No user surface:** it is absent from slash-command completion, help, CLI
   flags, tool registration and lazy discovery, settings UI, hubs, prompts,
   startup text, notifications, and generated documentation.
2. **No configuration back door:** a legacy config key, environment variable,
   prompt magic word, extension reload, or resumed old session cannot activate
   it. Unknown legacy configuration must be ignored with a clear migration
   message or rejected safely, according to the fork's runtime config policy.
3. **No lifecycle:** instrument network, credential reads, filesystem writes,
   child processes, watchers, timers, and persistent stores during startup and
   ordinary use. Disabled code performs none of them.
4. **No accidental reachability:** direct RPC/SDK requests and model-emitted
   tool calls cannot invoke a disabled handler by name.
5. **Baseline remains intact:** for `BASELINE ONLY`, the ordinary Pi-compatible
   behavior named in the matrix still works while the OMP-specific addition is
   absent.

The narrowed rows require explicit negatives as well: schemas do not become a
universal agent requirement (05), `/tan` is absent (10), internal-resource
schemes are limited to the exact set in ID 31, the broad web-search cascade plus
specialized handlers are absent (41), and fallback-chain editing plus a
synthetic `/model-hub` surface are absent (71). The existence of dormant source
files is not a failure; any registration, advertisement, initialization,
implicit activation, or side effect is.

## Consumer release scope

This repository publishes source-only downstream tags and makes no platform,
architecture, terminal, installer, or package-manager support claim on behalf
of a consumer. A consuming distribution may advertise a target only after its
artifact passes the shared startup/idle and interactive obligations plus that
distribution's packaging, installation, update, rollback, and terminal smoke
tests.

## Automated evidence requirements

The fork acceptance suite must include:

- a real-PTY golden/semantic test for the first plan and Ask canary, including
  viewport resize and Esc behavior;
- fixture-backed end-to-end tests for every selected journey, with the matrix
  reference embedded in the test metadata;
- a generated coverage check proving all 60 selected matrix references and all
  negative rows map to tests exactly once or to an explicitly documented set of
  complementary tests;
- startup and idle instrumentation proving disabled families are inert; and
- a clean source build smoke proving the narrowed ID 86 engine boundary.

Each consuming distribution's release suite must additionally include clean and
existing-state install, update, uninstall, and rollback tests plus at least one
artifact smoke on every advertised platform and terminal class.

Unit tests may support these checks, but cannot replace them.

## Source-tag and consumer cutover gates

A downstream source tag is acceptance-ready only when gates 1-5 are satisfied.
A consuming distribution may promote that source as its real `pi` only when all
seven gates are satisfied:

1. **Scope is frozen:** the upstream OMP pin, matrix decisions, and intentional
   deviations from native OMP behavior are recorded and reviewed.
2. **Runtime identity is correct:** the build exposes the command `pi`, does not
   add a second user-facing `omp` command, and `pi --version` identifies the
   downstream build and OMP base pin.
3. **The first canary is indistinguishable where it matters:** completion,
   one-step `/plan <prompt>`, rich Ask, review, refinement, cancellation,
   session resume, and all approval paths match the pinned OMP baseline apart
   from documented branding/scope changes.
4. **Positive scope is real:** all 60 selected journeys pass. Every conditional
   feature has a fixture-backed successful path; `BLOCKED` or unavailable-only
   evidence is not release-complete for an advertised feature.
5. **Negative scope is real:** every disabled/narrowed row passes surface,
   direct-invocation, legacy-state, startup, and idle inertness checks.
6. **Consumer state safety is proven:** development and release tests leave the
   real `~/.pi` untouched. Migration is rehearsed against a copy, is idempotent,
   preserves auth/settings/sessions promised by the distribution, and has a
   verified rollback. A failed install or migration restores the prior working
   `pi`.
7. **Consumer packaging survives:** the Pi-compatible baseline journeys named
   in the matrix, clean install/update/uninstall, and all advertised platform
   smokes pass from the consumer's final release artifact rather than a source
   checkout.

Source tagging and consumer cutover are deliberate operations after their
respective gates, not side effects of development installation.
