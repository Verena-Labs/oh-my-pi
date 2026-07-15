# web_search

> Search the current web through Pi's selected provider and return grounded text with source URLs.

## Source

- Entry: `packages/coding-agent/src/web/search/index.ts`
- Selection policy: `packages/coding-agent/src/web/search/provider.ts`
- Public provider metadata: `packages/coding-agent/src/web/search/types.ts`
- Codex adapter: `packages/coding-agent/src/web/search/providers/codex.ts`
- DuckDuckGo adapter: `packages/coding-agent/src/web/search/providers/duckduckgo.ts`
- Model-facing prompt: `packages/coding-agent/src/prompts/tools/web-search.md`
- Built-in registration: `packages/coding-agent/src/tools/index.ts`

## Inputs

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `query` | `string` | Yes | Search query. |
| `recency` | `"day" \| "week" \| "month" \| "year"` | No | Time filter. DuckDuckGo maps it to its HTML search filter; Codex currently ignores it. |
| `limit` | `number` | No | Requested result count. DuckDuckGo clamps it to `1..20`; Codex locally caps returned sources. |
| `num_search_results` | `number` | No | Alternate result-count input. It takes precedence over `limit` when both are present. |
| `max_tokens` | `number` | No | Accepted for schema compatibility; the selected providers do not use it. |
| `temperature` | `number` | No | Accepted for schema compatibility; the selected providers do not use it. |

Provider choice is not exposed to the model. Operators select it with the
`providers.webSearch` setting or with `pi search --provider` for an explicit
CLI query.

## Selected providers

Pi exposes exactly these web-search providers:

- `codex` — OpenAI native web search using the saved `openai-codex` OAuth
  credential. Sign in through `/login openai-codex` in an interactive Pi
  session. Search does not require a separate API-key environment variable.
- `duckduckgo` — Credential-free search through DuckDuckGo's no-JavaScript HTML
  endpoint. It supports recency and result-count filters, but the endpoint may
  throttle automated or shared-egress traffic.

`providers.webSearch` accepts `auto`, `codex`, or `duckduckgo`. In `auto` mode,
Pi uses Codex when a saved credential is available and otherwise uses
DuckDuckGo. The broad upstream provider cascade is not part of this Pi
distribution.

Fallback is opt-in. `providers.webSearchFallback` defaults to `false`; when it
is enabled, Pi may try the other selected provider after the chosen provider
fails or returns no renderable content. Exclusions in
`providers.webSearchExclude` apply to both primary selection and fallback. If
no selected provider remains available, the tool returns a normal error result
without starting a network request.

## Outputs

The tool returns one text content block plus structured render details:

- `content`: `[{ type: "text", text: string }]`
- `details.response`: normalized provider response containing `provider`,
  `sources`, and optional answer, citation, usage, model, or request metadata
- `details.error`: present when no selected provider succeeds

The text formatter emits an answer first when available, followed by numbered
sources. Source snippets and citation text are truncated to 240 characters.
Search-query metadata is capped at three entries of 120 characters each.

Provider failures are returned as `Error: ...` tool content rather than thrown
through the tool boundary. User cancellation remains an abort and is rethrown
instead of being disguised as a provider failure.

## Flow

1. `WebSearchTool.execute()` resolves the configured provider chain.
2. Pi loads only the selected provider adapter on demand.
3. The provider receives the query, selected filters, session credential
   context, and cancellation signal.
4. A response with no answer, sources, citations, related questions, or search
   queries counts as a provider failure.
5. With fallback disabled, that failure is final. With fallback enabled, Pi
   tries the other selected provider.
6. The first renderable response is normalized for the model and terminal.

## Side effects

- Network access occurs only when a selected provider is available and a
  search is explicitly invoked.
- Provider adapters are loaded lazily and cached for the process after first
  use.
- The tool starts no subprocesses and creates no independent persistent store.
- Tool availability still obeys `web_search.enabled` and ordinary tool
  discovery/activation settings.

## Errors

- No selected provider available: `Error: No web search provider configured.`
- Codex credential missing while Codex is explicitly selected and fallback is
  disabled: the same no-provider error.
- Provider HTTP, authorization, protocol, or empty-response failures surface a
  provider-specific message.
- If opt-in fallback exhausts both selected providers, the result summarizes
  the ordered failures.
