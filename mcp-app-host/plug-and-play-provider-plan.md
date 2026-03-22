# Plan: Plug-and-Play Provider Architecture for mcp-app-host

## TL;DR

Decouple mcp-app-host/src/server/agent.ts from the Anthropic SDK by introducing a provider abstraction layer (inspired by root `providers/`), then implement an AWS Bedrock adapter as the first alternative. Anthropic coupling is concentrated in ONE file (agent.ts) — the rest of the codebase (conversation store, chat events, MCP client, frontend) is already provider-agnostic.

## Coupling Assessment

**Good news**: Anthropic SDK usage is confined to `agent.ts` only. The coupling points are:

1. `import Anthropic from "@anthropic-ai/sdk"` — SDK import
2. `new Anthropic()` — client instantiation
3. `Anthropic.MessageParam[]` — conversation history type
4. `Anthropic.ContentBlockParam` — message content blocks
5. `Anthropic.ToolResultBlockParam` — tool results
6. `Anthropic.ContentBlock & { type: "tool_use" }` — response parsing
7. `Anthropic.Tool` / `Anthropic.Tool["input_schema"]` — tool definitions
8. `anthropic.messages.stream()` — streaming API call
9. `stream.on("text", ...)` — text delta events
10. `stream.finalMessage()` — final response

**Already provider-agnostic** (no changes needed):

- `chat-events.ts` — SSE event types use plain strings
- `conversation-store/` — stores generic `Record<string, unknown>` content
- `mcp-client.ts` — tool format is `{ name, description, input_schema: Record }` (not Anthropic types)
- `local-tools.ts` / `skills-registry.ts` — no SDK dependency
- All frontend code — works with SSE events only

## Key Design Decision: Streaming

The root project's `ModelProvider` interface returns a `Promise<ModelResponse>` (non-streaming). But mcp-app-host needs streaming for SSE text deltas. Two options:

- **Option A**: Provider interface with `onTextDelta` callback (like root Anthropic provider already supports) — keeps the interface simple, agent passes a callback
- **Option B**: Provider returns an async iterator / ReadableStream of chunks — more standard but more complex

**Recommendation**: Option A (callback) — it matches the existing root pattern and is simpler. The Bedrock SDK supports `ConverseStreamCommand` which can feed deltas into the callback.

## Steps

### Phase 1: Provider Abstraction Layer (new files)

1. **Create `mcp-app-host/src/server/providers/types.ts`**
   - Define provider-agnostic message types (adapted from root `providers/types.ts`):
     - `ProviderMessage` — `{ role: "user" | "assistant"; content: string | ProviderContentBlock[] }`
     - `ProviderContentBlock` — union: `ProviderTextBlock | ProviderToolUseBlock | ProviderToolResultBlock`
     - `ProviderToolUseBlock` — `{ type: "tool_use"; id: string; name: string; input: Record<string, unknown> }`
     - `ProviderToolResultBlock` — `{ type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean }`
     - `ProviderTool` — `{ name: string; description: string; input_schema: Record<string, unknown> }`
   - Define `ProviderResponse` — `{ content: ProviderContentBlock[]; stopReason: "end_turn" | "tool_use" | "max_tokens"; usage?: { inputTokens: number; outputTokens: number } }`
   - Define `ModelProvider` interface:
     ```
     streamResponse(
       messages: ProviderMessage[],
       tools: ProviderTool[],
       systemPrompt: string,
       onTextDelta: (text: string) => void
     ): Promise<ProviderResponse>
     ```

2. **Create `mcp-app-host/src/server/providers/anthropic.ts`**
   - Implement `ModelProvider` wrapping the existing Anthropic SDK logic from agent.ts
   - Convert `ProviderMessage[]` → `Anthropic.MessageParam[]` before calling API
   - Convert `ProviderTool[]` → `Anthropic.Tool[]`
   - Use `anthropic.messages.stream()` with `stream.on("text", onTextDelta)`
   - Convert `response.content` → `ProviderContentBlock[]` in the return
   - Config: `{ model: string; maxTokens: number; apiKey?: string }`

3. **Create `mcp-app-host/src/server/providers/bedrock.ts`**
   - Implement `ModelProvider` using `@aws-sdk/client-bedrock-runtime`
   - Use `ConverseStreamCommand` (NOT `ConverseCommand` like root project) for streaming support
   - Convert `ProviderMessage[]` → Bedrock's `Message[]` format
   - Convert `ProviderTool[]` → Bedrock's `ToolConfiguration`
   - Feed content block deltas into `onTextDelta` callback
   - Assemble final response from accumulated stream events
   - Config: `{ model: string; maxTokens: number; region: string }`
   - Reference root `providers/bedrock.ts` for message/tool format conversion logic

4. **Create `mcp-app-host/src/server/providers/index.ts`**
   - Export types and both provider classes
   - Export `createProvider(config)` factory that reads env vars (`AI_PROVIDER`, etc.)

### Phase 2: Refactor agent.ts

5. **Refactor `agent.ts` to use provider abstraction**
   - Remove `import Anthropic from "@anthropic-ai/sdk"`
   - Remove `const anthropic = new Anthropic()`
   - Import `ModelProvider`, `ProviderMessage`, `ProviderContentBlock`, etc. from `./providers/index.js`
   - Create provider instance at module level via factory
   - Change `SessionState.history` from `Anthropic.MessageParam[]` to `ProviderMessage[]`
   - Change `getToolsForRequest()` return type from `Anthropic.Tool[]` to `ProviderTool[]`
   - Replace `anthropic.messages.stream()` block with `provider.streamResponse()` call
   - Update `hydrateSessionIfNeeded()` to build `ProviderMessage[]` instead of `Anthropic.MessageParam[]`
   - Update tool result collection to use `ProviderToolResultBlock` instead of `Anthropic.ToolResultBlockParam`
   - Update tool_use block detection to use `ProviderToolUseBlock` instead of `Anthropic.ContentBlock & { type: "tool_use" }`

6. **Update `mcp-client.ts` (minimal)**
   - `getToolsForNames()` already returns `{ name, description, input_schema }` — just update the type annotation to use `ProviderTool` if desired, or leave as-is since the shapes are compatible

### Phase 3: Configuration & Dependencies

7. **Update `mcp-app-host/package.json`**
   - Add `@aws-sdk/client-bedrock-runtime` dependency
   - Keep `@anthropic-ai/sdk` (still needed for the Anthropic provider)

8. **Update environment variable handling**
   - Add `AI_PROVIDER` env var (default: "anthropic" for backward compat)
   - Add `BEDROCK_MODEL`, `AWS_REGION` vars
   - Document in README

### Phase 4: Verification

9. **Manual testing**
   - Test with `AI_PROVIDER=anthropic` — existing behavior should be identical
   - Test with `AI_PROVIDER=bedrock` — full agent loop with streaming, tool use, skill loading
   - Verify conversation rehydration works with provider-agnostic history format

## Relevant Files

**To create:**

- `mcp-app-host/src/server/providers/types.ts` — provider-agnostic types (message, response, tool)
- `mcp-app-host/src/server/providers/anthropic.ts` — Anthropic adapter implementing `ModelProvider`
- `mcp-app-host/src/server/providers/bedrock.ts` — Bedrock adapter implementing `ModelProvider`
- `mcp-app-host/src/server/providers/index.ts` — exports + factory

**To modify:**

- `mcp-app-host/src/server/agent.ts` — replace all Anthropic SDK usage with provider abstraction
- `mcp-app-host/package.json` — add `@aws-sdk/client-bedrock-runtime`

**Reference (read-only):**

- `providers/types.ts` — reuse message/content block type design
- `providers/bedrock.ts` — reuse Bedrock message conversion logic, tool format mapping
- `providers/anthropic.ts` — reference for Anthropic streaming + cache patterns

**No changes needed:**

- `mcp-app-host/src/shared/chat-events.ts` — already provider-agnostic
- `mcp-app-host/src/server/conversation-store/` — already provider-agnostic
- `mcp-app-host/src/server/mcp-client.ts` — tool format already compatible
- `mcp-app-host/src/server/local-tools.ts` — no SDK dependency
- `mcp-app-host/src/server/skills-registry.ts` — no SDK dependency
- All frontend code

## Decisions

- **Streaming is required** — mcp-app-host sends SSE text deltas; provider interface must support streaming (not just request/response)
- **Callback-based streaming** (Option A) — simpler than async iterators, matches root project pattern
- **Bedrock uses `ConverseStreamCommand`** — root project uses non-streaming `ConverseCommand` which won't work for SSE; we need the streaming variant
- **Conversation history format changes** — existing persisted conversations use provider-agnostic event format (not Anthropic types), so no migration needed. The in-memory `SessionState.history` changes type but rehydration rebuilds from events anyway.
- **Phase 1 scope**: Anthropic + Bedrock only. Ollama deferred to a later phase.
- **Root providers/ NOT imported directly** — mcp-app-host will have its own providers/ since it's moving to a separate repo. We copy the design patterns and Bedrock conversion logic, but the interface differs (streaming support).

## Further Considerations

1. **Prompt caching**: Anthropic supports prompt caching (5m/1h TTL). Bedrock supports it differently. Should we include cache control in the provider interface? **Recommendation**: Skip for Phase 1, add later — mcp-app-host doesn't currently use prompt caching.

2. **Model-specific system prompt tweaks**: Bedrock Claude models may need slightly different system prompt formatting. **Recommendation**: Keep system prompt generation in agent.ts (provider-agnostic), let providers handle any wire-format differences internally.

3. **Bedrock authentication**: AWS credentials via environment/IAM role (standard SDK chain). No API key needed. Worth documenting the IAM permissions required (`bedrock:InvokeModelWithResponseStream`).
