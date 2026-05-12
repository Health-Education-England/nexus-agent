# MCP App Host — Orchestrator + Sub-Agent Configuration

This document describes how the `mcp-app-host/` project is wired. It uses the **same conceptual pattern** as the root CLI (orchestrator + specialised sub-agent), but the boundary between them is the **Model Context Protocol (MCP)** over HTTP instead of an in-process function call.

## The orchestrator

Lives in [mcp-app-host/src/server/agent.ts](mcp-app-host/src/server/agent.ts). It's a streaming SSE chat endpoint that:

- Picks its provider/model via `createProvider(...)` — plug-and-play, controlled by env vars (`AI_PROVIDER=anthropic | bedrock`, etc.) at [agent.ts:41](mcp-app-host/src/server/agent.ts#L41).
- Runs the same tool-use loop as the CLI agent, with two notable additions:
  - **Agent Skills**: a `read_skill` meta-tool gates each skill — its tool schemas only appear in the API request after the model has loaded the matching `SKILL.md` ([agent.ts:289-319](mcp-app-host/src/server/agent.ts#L289-L319)).
  - **Conversation persistence** via `FileConversationStore`.

## The "sub-agent" — now a separate process

The Gold Guide sub-agent is no longer an in-process call — it's a standalone Express + MCP server: [mcp-app-host/gold-guide-server/src/server/index.ts](mcp-app-host/gold-guide-server/src/server/index.ts). It:

- Runs its own Express server on port 3002 with a **Streamable HTTP MCP transport**.
- Registers the same `ask_gold_guide` tool ([index.ts:66-106](mcp-app-host/gold-guide-server/src/server/index.ts#L66-L106)).
- Owns its own Anthropic client and pins its own model (`claude-haiku-4-5-20251001`) inside `queryGoldGuide(...)` — nothing the orchestrator sets affects this.

The `ltft-server` is the other MCP server (the LTFT calculator), following the same pattern.

## How they connect

The orchestrator's `mcp-client` discovers tools from the MCP servers ([agent.ts:24](mcp-app-host/src/server/agent.ts#L24)). When the orchestrator calls `ask_gold_guide`, `executeTool(...)` forwards the call over MCP to the gold-guide server, which runs its own LLM call and returns `ANSWER + CITATIONS`.

## Key differences vs the CLI version

| Aspect | CLI (`src/main.ts`) | mcp-app-host |
| --- | --- | --- |
| Sub-agent boundary | direct function call (`askGoldGuide`) | MCP over HTTP |
| Sub-agent provider/model | injected from `main.ts` using `PRODUCTION_CONFIG` | owned entirely by the MCP server process |
| Tools surface | constructed in `main.ts` | discovered via MCP + local meta-tools, gated by skills |
| State | in-memory | persisted via `ConversationStore` |

Conceptually identical pattern (orchestrator delegates policy questions to a Haiku-backed Gold Guide expert); architecturally the sub-agent is now a standalone service rather than a co-located module.

## Where the sub-agent's model and API key are set

### API key

The gold-guide MCP server reuses the **same** `ANTHROPIC_API_KEY` as the orchestrator because it loads the *same* root `.env` from the `mcp-app-host` parent directory ([index.ts:19-20](mcp-app-host/gold-guide-server/src/server/index.ts#L19-L20)):

```ts
const __envDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__envDir, "../../../.env") });
```

The `anthropicClient` is just the SDK client object, not the model — it carries the API key and the HTTP transport.

### Model

The model is hardcoded as a module constant inside the sub-agent's query function:

```ts
// mcp-app-host/gold-guide-server/src/core/query-gold-guide.ts:98
const MODEL = "claude-haiku-4-5-20251001";
```

It is then passed in the `client.beta.messages.create({ model: MODEL, ... })` call at [query-gold-guide.ts:135-154](mcp-app-host/gold-guide-server/src/core/query-gold-guide.ts#L135-L154). The startup log line at [index.ts:193](mcp-app-host/gold-guide-server/src/server/index.ts#L193) just prints that same string — it's a literal in the log, not a config source.

### Compared to the CLI sub-agent

| Aspect | CLI sub-agent | mcp-app-host sub-agent |
| --- | --- | --- |
| Where the model lives | `PRODUCTION_CONFIG.models.answer` in [production-config.ts:23](gold-guide-expert/sub-agent/production-config.ts#L23) | `MODEL` const in [query-gold-guide.ts:98](mcp-app-host/gold-guide-server/src/core/query-gold-guide.ts#L98) |
| Pipeline indirection | `PipelineConfig` + `PIPELINE_FACTORIES` | stripped out — CAG hardcoded (see header comment at [query-gold-guide.ts:4-6](mcp-app-host/gold-guide-server/src/core/query-gold-guide.ts#L4-L6)) |
| Provider abstraction | `ModelProvider` interface | Anthropic SDK called directly |

To swap the gold-guide sub-agent's model in mcp-app-host **today**, you edit that `MODEL` constant. There is no env override and no config object — the MCP-server version was deliberately simplified, with the `ModelProvider` and `PipelineConfig` abstractions stripped out.

## Next steps — improving config visibility

A few low-cost moves, in roughly increasing order of effort:

- **Tiny step — env var for the model.** Add a `GOLD_GUIDE_MODEL` env var with the current value as the default, and log the actual model from the variable so the startup banner can't drift from reality.
- **Medium step — `config.ts` for the server.** A small `config.ts` in `gold-guide-server/src/` that exports `{ model, maxTokens, port, apiKey }` keeps `index.ts` clean and gives you one place to look. This mirrors the role `production-config.ts` plays in the CLI version.
- **Bigger step — bring back a pipeline config.** Re-introduce something like the CLI's `PipelineConfig` shape so the MCP server could host alternative pipelines (CAG / RAG / future) without code edits. Only worth it if you actually expect to switch pipelines in production rather than just during evaluation.

## Next steps — making the provider pluggable (Anthropic ↔ Bedrock ↔ …)

The orchestrator side already has the template for this: it uses [`createProvider(...)`](mcp-app-host/src/server/agent.ts#L41) which returns a unified interface regardless of whether `AI_PROVIDER=anthropic` or `bedrock`. The gold-guide MCP server just hasn't been brought along yet — it imports the Anthropic SDK directly at [index.ts:23](mcp-app-host/gold-guide-server/src/server/index.ts#L23) and calls `client.beta.messages.create(...)` directly at [query-gold-guide.ts:135](mcp-app-host/gold-guide-server/src/core/query-gold-guide.ts#L135).

### The two coupling points to break

1. **Client construction** — currently `new Anthropic({ apiKey })` in [index.ts:35-37](mcp-app-host/gold-guide-server/src/server/index.ts#L35-L37). Replace with the same `createProvider(...)` factory the orchestrator uses, returning a `ModelProvider` instead of an SDK-specific client.
2. **The API call itself** — currently uses Anthropic-specific features: `beta.messages.create`, the `betas: ["prompt-caching-2024-07-31"]` flag, and `cache_control: { type: "ephemeral" }` on the context block ([query-gold-guide.ts:135-154](mcp-app-host/gold-guide-server/src/core/query-gold-guide.ts#L135-L154)). This is the harder bit — **prompt caching is the whole reason CAG is affordable here** (full Gold Guide ≈ 80K tokens per call, cached after the first hit).

### The prompt-caching question is the real design decision

- **Anthropic API**: `cache_control: { type: "ephemeral" }` blocks, ~10× cheaper on hits, 5-minute TTL.
- **Bedrock (Anthropic models)**: supports prompt caching but with a different API shape — the provider abstraction would need to expose a "mark this block as cacheable" primitive rather than passing Anthropic's raw shape through.
- **Bedrock (non-Anthropic models, e.g. Nova, Llama)**: no equivalent. CAG with 80K tokens per call would be cost-prohibitive without caching — at that point you would want to switch pipeline to RAG (retrieve only relevant chunks), not just swap the client.

### Suggested shape when you tackle it

Extend the `ModelProvider` interface in [mcp-app-host/src/server/providers/](mcp-app-host/src/server/providers/) with a `complete(...)` method that accepts content blocks with an optional `cacheable: true` hint, and let each provider implementation translate that to its own caching mechanism (or no-op it). Then `queryGoldGuide(question, provider)` instead of `(question, client)`, and the provider type is what swaps.

### Suggested migration order

1. Surface model via env var (cheap, do now).
2. Extract `config.ts` for the server (cheap).
3. Adopt `ModelProvider` for the client (medium — but reuses the orchestrator's existing factory).
4. Decide caching strategy per provider (the real design work — and the point where pipeline choice and provider choice start interacting).

Worth flagging now so future-you doesn't accidentally build a provider abstraction that pretends caching is universal — it isn't, and the answer might be "non-Anthropic providers force a RAG pipeline" rather than "make caching work everywhere."
