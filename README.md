# Nexus Agent

**Nexus Agent** is an LLM-powered orchestration system designed to support UK foundation and specialist training workflows. Acting as a central hub (or "nexus"), it interprets complex user (e.g. PGDT) queries and intelligently (hopefully!) routes them to specialised sub-agents and tools such as a Gold Guide policy expert to provide accurate, source-grounded answers.

## Architecture

NOTE: This architecture shows other tools in addition to the **ask_gold_guide** tool. Their primary purpose is to demonstrate the orchestration process rather than being polished production-ready tools in their own right.

```text
                        ┌─────────────────────────────────┐
                        │        Orchestrator Agent       │
                        │   (routes to tools/sub-agents)  │
                        └───────────────┬─────────────────┘
                                        │
            ┌───────────────────────────┼───────────────────────────┐
            │                           │                           │
   ┌────────▼───────────────┐  ┌────────▼───────────────┐  ┌────────▼───────────────┐
   │     ask_gold_guide     │  │     show_ltft_form     │  │  get_current_datetime  │
   │       (Sub-Agent)      │  │         (Tool)         │  │         (Tool)         │
   └────────┬───────────────┘  └────────┬───────────────┘  └────────────────────────┘
            │
            │                           │
            │                  ┌────────▼───────────────┐
            │                  │    ltft_calculator     │
            │                  │         (Tool)         │
            │                  └────────────────────────┘
            │
   ┌────────▼────────────────────────────┐
   │          Gold Guide Module          │
   │          queryGoldGuide()           │
   │     ┌──────────┐    ┌──────────┐    │
   │     │   CAG    │    │   RAG    │    │
   │     │ Pipeline │    │ Pipeline │    │
   │     └──────────┘    └──────────┘    │
   └─────────────────────────────────────┘
```

The **Orchestrator** is the main LLM agent that receives user queries, decides which tools to call, and synthesises a final response. The **Gold Guide Expert** is a sub-agent that runs an entire retrieval pipeline (CAG or RAG) behind the scenes.

For LTFT date changes, the agent now uses a two-step tool flow: `show_ltft_form` renders an inline form card in the web UI, then the submitted JSON is passed straight to `ltft_calculator` to produce the updated CCT date.

## Project Structure

```text
providers/                  # Model provider adapters (shared infrastructure)
├── types.ts                # Provider-agnostic interfaces: ModelProvider, Message,
│                           #   ToolDefinition, ContentBlock, ModelResponse, etc.
├── anthropic.ts            # Anthropic direct API
├── bedrock.ts              # AWS Bedrock Converse API
├── ollama.ts               # Ollama local models (OpenAI-compatible)
├── provider-factory.ts     # createProviderFromEnv() + named provider helpers
└── index.ts

shared/                     # Cross-cutting utilities (no app or domain concerns)
├── error-format.ts         # formatUnknownError(), formatErrorCauseSuffix()
└── normalize-stop-reason.ts

src/                        # Orchestrator application
├── agent/
│   ├── agent.ts            # Agent class (interactive + programmatic chat)
│   ├── constants.ts        # System prompt, MAX_TOKENS, MAX_TOOL_TURNS
│   └── index.ts
├── public/                 # Web UI static assets (served by src/server.ts)
│   ├── index.html
│   ├── scripts/
│   │   ├── app.js                  # App bootstrap + DOM wiring
│   │   ├── assistant-renderer.js   # Streaming assistant bubble rendering
│   │   ├── chat-stream.js          # SSE event parsing + dispatch
│   │   ├── chat-view.js            # Chat history + welcome state rendering
│   │   ├── conversation-controller.js # Sidebar load/delete/undo flows
│   │   ├── ltft-widget.js          # Inline LTFT form widget
│   │   └── widget-registry.js      # Widget type registration
│   ├── styles/main.css
│   └── README.md
├── tools/                  # Orchestrator tool definitions
│   ├── datetime.tool.ts
│   ├── ltft-form.tool.ts
│   ├── ltft-calculator.tool.ts
│   └── gold-guide-expert.tool.ts   # Re-exports from gold-guide-expert/sub-agent
├── utils/
│   └── colours.ts          # ANSI colour codes for CLI output
├── main.ts                 # Interactive CLI entry point
├── input-handler.ts        # Readline-based CLI input
└── server.ts               # Express web server + SSE chat + conversation CRUD

gold-guide-expert/          # Self-contained Gold Guide domain module
├── core/                   # Stateless retrieval library
│   ├── types.ts            # PipelineConfig, GoldGuideResult, Citation, etc.
│   ├── errors.ts           # Domain error types (RetrievalError, etc.)
│   ├── query-gold-guide.ts # queryGoldGuide() — shared entry point
│   ├── retrieval/          # Pluggable retrieval pipeline implementations
│   │   ├── cag-pipeline.ts
│   │   ├── rag-pipeline.ts
│   │   ├── hybrid-pipeline.ts
│   │   ├── embeddings/     # EmbeddingProvider implementations
│   │   └── vector-store/   # VectorStore implementations (Qdrant)
│   └── index.ts
├── evaluation/             # Batch evaluation harness (imports core/ + providers/)
│   ├── types.ts            # QAItem, ScoredResult, EvalRunSummary, etc.
│   ├── config.ts           # Dataset loader + eval pipeline ID aliases
│   ├── pipeline-registry.ts # Single source of truth for all pipeline configs
│   ├── runner.ts           # Batch loop: reads QA set → queryGoldGuide → judge
│   ├── judge.ts            # LLM-as-judge scoring
│   ├── metrics.ts          # Aggregate metric computation
│   └── index.ts
├── sub-agent/              # Production wrapper (imports core/ + providers/)
│   ├── gold-guide-sub-agent.ts  # Conversation-aware wrapper
│   ├── production-config.ts     # PRODUCTION_CONFIG — points to evaluation winner
│   ├── tool-definition.ts       # ToolDefinition for the Orchestrator
│   └── index.ts
├── scripts/                # One-off data preparation scripts
│   ├── parse-pdf.py
│   ├── clean-markdown.ts
│   ├── canonicalise.ts
│   ├── ingest-vectors.ts
│   └── list-anthropic-models.ts
├── data/                   # Non-code assets
│   ├── raw/                # Original Gold Guide source
│   ├── markdown/           # Parsed + canonicalised markdown
│   └── qa/                 # QA datasets (development, frozen, stress)
└── docs/                   # Research & planning documents
```

### Dependency layers

```text
shared/            ← (no internal deps)
providers/         ← shared/
gold-guide-expert/ ← providers/  shared/
src/               ← providers/  shared/  gold-guide-expert/
```

### Key design: shared `queryGoldGuide()`

```text
src/tools/gold-guide-expert.tool.ts     →  gold-guide-expert/sub-agent/
gold-guide-expert/sub-agent/            →  gold-guide-expert/core/queryGoldGuide()
gold-guide-expert/evaluation/runner.ts  →  gold-guide-expert/core/queryGoldGuide()
```

Both the production sub-agent and the evaluation harness call the same stateless
`queryGoldGuide(question, config)` function. Pipeline configs are managed in a
central registry (`evaluation/pipeline-registry.ts`) — the production config is just a
pointer to the evaluation winner.

## Quick Start

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys and model choice

# Interactive mode (Orchestrator with all tools)
npm run dev

# Web mode (Express server + browser chat UI)
npm run dev:web

# Run evaluation harness (CAG baseline)
npm run -s eval:cag

# Optional: single-item low-cost run for quick test
npm run -s eval:cag -- --limit 1
```

Open `http://localhost:3000` when running `npm run dev:web`.

### Web UI features (quick-and-dirty)

- Streams assistant responses to the browser over SSE (`POST /chat`).
- Supports tool-driven UI widgets over the same SSE stream, including the inline LTFT calculator form card.
- Auto-saves each conversation turn to `conversations/conversation-<id>.json`.
- Lists existing conversations in the sidebar (`GET /conversations`).
- Loads a prior conversation (`GET /conversations/:id`).
- Deletes a conversation with confirmation + short undo window in the UI (server delete endpoint: `DELETE /conversations/:id`).
- Renders LTFT calculation results as a concise Markdown table returned by the calculator tool.

### LTFT calculator flow

1. The user asks for an LTFT CCT calculation.
2. The agent calls `show_ltft_form`, which emits a widget event and stops the current inference loop.
3. The browser renders an inline LTFT form card and submits the completed values as the user's next message.
4. The agent calls `ltft_calculator` with that JSON payload and returns the recalculated CCT date.

Note: the web UI is intentionally lightweight and currently aimed at local development use.

### RAG pipeline setup

The naive RAG pipeline requires local infrastructure (Ollama + Qdrant).
See `gold-guide-expert/README.md` for full setup instructions.

```bash
# Quick version:
ollama pull qwen3-embedding:8b  # download embedding model (~4.7GB)
npm run rag:services:up          # start Qdrant (Docker)
npm run rag:ingest               # embed + ingest chunks
npm run -s eval:rag              # run RAG evaluation
```

### Using Ollama for the orchestrator / answer / judge models

Any LLM role in the stack can run on a local Ollama chat model instead of a
cloud provider, for zero-cost development and experimentation.

```bash
# 1. Pull a model
ollama pull qwen3.5:9b    # 6.6GB, good balance of quality and speed

# 2. Set environment variables
AI_PROVIDER=ollama
OLLAMA_MODEL=qwen3.5:9b
# OLLAMA_NUM_CTX=16384      # increase for long documents (default: 8192)

# 3. Run interactively
npm run dev

# 4. Or run evaluation with a local pipeline alias
npm run -s eval:cag -- --pipeline cagLocal --limit 1
```

Smaller models (e.g. `qwen3.5:4b`) also work and are faster, but may
produce lower-quality tool calling and citation pass-through. See
`gold-guide-expert/README.md` for local evaluation pipeline aliases.

For detailed Gold Guide evaluation commands, judge modes, model override options,
and artifact locations, see `gold-guide-expert/README.md`.

## Environment Variables

| Variable            | Required     | Description                           |
| ------------------- | ------------ | ------------------------------------- |
| `AI_PROVIDER`       | Yes          | `anthropic`, `bedrock`, or `ollama`   |
| `ANTHROPIC_API_KEY` | If anthropic | API key                               |
| `ANTHROPIC_MODEL`   | If anthropic | Model ID                              |
| `BEDROCK_MODEL`     | If bedrock   | Bedrock model ID                      |
| `AWS_REGION`        | If bedrock   | AWS region                            |
| `OLLAMA_MODEL`      | If ollama    | Ollama chat model (e.g. `qwen3.5:9b`) |
| `OLLAMA_BASE_URL`   | No           | Ollama URL (default: localhost:11434) |
| `OLLAMA_NUM_CTX`    | No           | Context window tokens (default: 8192) |
| `QDRANT_URL`        | No           | Qdrant URL (default: localhost:6333)  |

Note: Bedrock provider is scaffolded but not yet fully implemented.

## Testing Plan Alignment

This project implements the testing harness from `gold-guide-expert/docs/testing-phase-high-level-plan.txt`:

1. **Parse PDF to Markdown** → Place output in `gold-guide-expert/data/markdown/`
2. **Canonicalise with IDs** → Process the markdown with immutable IDs
3. **Golden Datasets** → Create `development`, `frozen`, and `stress` QA sets in `gold-guide-expert/data/qa/`
4. **Testing Harness** → `gold-guide-expert/evaluation/runner.ts`
5. **CAG Baseline** → Run `development` set through the CAG pipeline (model/provider TBD) to establish a baseline. We might run CAG a number of times e.g. using different providers/models etc.
6. **Naive RAG** → Run `development` set through a simple RAG pipeline (model/provider TBD) and calibrate
7. **Hybrid RAG / Iteration** → Iterate retrieval techniques and parameters based on `development` set evaluation results
8. **Final Validation** → Validate the best pipeline against the `frozen` set (for final metrics) and `stress` set (for safety/adversarial robustness)

NOTE: Again a WIP/sensible plan based on research to date that may change when we begin implementing/testing things properly.
