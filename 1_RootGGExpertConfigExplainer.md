# Gold Guide Expert — CLI Orchestrator + Sub-Agent Configuration

This document describes how the **root** `gold-guide-expert/` module is wired into the CLI agent in `src/main.ts`. It uses an in-process orchestrator + sub-agent pattern.

## Two independent model choices

1. **Orchestrator model** — chosen at startup from env vars via `createProviderFromEnv(...)` in [src/main.ts:20](src/main.ts#L20). This is the agent the user actually talks to.
2. **Sub-agent model** — chosen by a hardcoded config in [gold-guide-expert/sub-agent/production-config.ts](gold-guide-expert/sub-agent/production-config.ts), currently `claude-haiku-4-5-20251001` via the `cag-haiku-anthropic` pipeline. The orchestrator's `.env` has no say over this.

```ts
// gold-guide-expert/sub-agent/production-config.ts
export const PRODUCTION_PIPELINE_ID = "cag-haiku-anthropic";

export const PRODUCTION_CONFIG: PipelineConfig = {
  pipeline: "cag",
  provider: "anthropic",
  models: {
    answer: "claude-haiku-4-5-20251001"
  }
};
```

## How the orchestrator and sub-agent are connected

In [src/main.ts:23-38](src/main.ts#L23-L38), a **separate** provider is built for the sub-agent using `PRODUCTION_CONFIG.models.answer` and `PRODUCTION_CONFIG.provider`. That provider is injected into `createGoldGuideExpertTool({ provider: subAgentProvider })`, which produces a `ToolDefinition` named `ask_gold_guide` ([gold-guide-expert/sub-agent/tool-definition.ts:30-55](gold-guide-expert/sub-agent/tool-definition.ts#L30-L55)).

That tool is then handed to the orchestrator alongside `DateTimeTool` and `LtftCalculatorTool`:

```ts
// src/main.ts
const subAgentModel = PRODUCTION_CONFIG.models.answer;
const subAgentProvider =
  PRODUCTION_CONFIG.provider === "ollama"
    ? createOllamaProvider(subAgentModel, MAX_TOKENS)
    : createAnthropicProvider(subAgentModel, MAX_TOKENS);

const tools = [
  DateTimeTool,
  LtftCalculatorTool,
  createGoldGuideExpertTool({ provider: subAgentProvider })
];

const agent = new Agent(provider, getUserMessage, tools);
```

## Runtime flow

1. User asks the orchestrator a question.
2. Orchestrator decides it's a policy question and calls `ask_gold_guide` with a `question` string.
3. The tool's `execute` calls `askGoldGuide(question, { provider: subAgentProvider, config })` ([gold-guide-sub-agent.ts:33-39](gold-guide-expert/sub-agent/gold-guide-sub-agent.ts#L33-L39)), which delegates to `queryGoldGuide` in `core/` — that's where retrieval + the actual LLM call happen, using the **sub-agent's** provider/model.
4. The result is formatted by `formatResultForOrchestrator` into an `ANSWER + CITATIONS + (pipeline/tokens/latency)` string ([gold-guide-sub-agent.ts:45-65](gold-guide-expert/sub-agent/gold-guide-sub-agent.ts#L45-L65)) and returned as the tool result.
5. Orchestrator synthesises that into the final reply to the user.

## CLI vs UI mode

The root project originally used only the CLI entrypoint in `src/main.ts`, but the web UI was later added via `src/server.ts`.

- `npm run dev` executes `src/main.ts` and starts the interactive CLI agent.
- `npm run dev:web` executes `src/server.ts` and starts the Express web server with the browser chat UI.

Both entrypoints use the same underlying model configuration:

- `createProviderFromEnv(MAX_TOKENS)` in each file builds the orchestrator model from environment variables.
- `PRODUCTION_CONFIG` from `gold-guide-expert/sub-agent/index.ts` defines the Gold Guide sub-agent model and provider.

So the switch from CLI to UI is not a separate model config change; it is a different startup path that reuses the same root config.

### Exact commands

```bash
npm run dev      # CLI mode
npm run dev:web  # UI mode
```

### Orchestrator model config

The orchestrator itself is configured entirely by `.env` values such as `AI_PROVIDER`, `ANTHROPIC_MODEL`, `BEDROCK_MODEL`, or `OLLAMA_MODEL`.

### Gold Guide sub-agent model config

The Gold Guide sub-agent model is configured in:

- `gold-guide-expert/sub-agent/production-config.ts`

That file is the authoritative source for the sub-agent pipeline/provider/model triple.

### Optional env-based override path

If you want a development shortcut without editing `production-config.ts`, you could add a small override in `src/main.ts` and `src/server.ts` around the sub-agent provider creation, for example:

```ts
const subAgentModel =
  process.env.GOLD_GUIDE_MODEL ?? PRODUCTION_CONFIG.models.answer;
```

That would let you quickly test a different Gold Guide model in CLI or UI mode using an environment variable instead of changing code.

If you want the UI and CLI to behave identically, leave `gold-guide-expert/sub-agent/production-config.ts` as the single source of truth for the Gold Guide sub-agent model.

If you ever need a true mode-specific override, you would add an override in `src/server.ts` or `src/main.ts` before `createGoldGuideExpertTool(...)`, but the current code does not distinguish the config between CLI and UI.

## Summary

To switch the sub-agent's model, edit `PRODUCTION_CONFIG` in [production-config.ts](gold-guide-expert/sub-agent/production-config.ts). The orchestrator is untouched. The orchestrator's own model continues to be controlled by env vars.

## Next steps — improving config visibility

The CLI version is already reasonably clear (one named export, one file), but there are still a few small improvements worth considering:

- **Surface the sub-agent model in the startup banner** — `src/main.ts` already logs `Gold Guide sub-agent model: ...` but it does so by reading `PRODUCTION_CONFIG.models.answer` directly. If a future change ever passes a different `config` override into `createGoldGuideExpertTool(...)`, the log would lie. Consider logging from inside the tool factory using the actual config it received.
- **Document the pipeline/provider/model triple in one place** — `PRODUCTION_CONFIG` already holds these three together, but the _meaning_ of `pipeline: "cag"` (full-document injection + prompt caching) is only documented in `core/`. A short README in `sub-agent/` explaining the production triple would help new contributors.
- **Env override for development** — currently you must edit `production-config.ts` to swap models. An optional `GOLD_GUIDE_MODEL` env var (falling back to `PRODUCTION_CONFIG.models.answer`) would let you experiment without code edits, while keeping the hardcoded default as the production source of truth.
