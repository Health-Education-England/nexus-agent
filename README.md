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
   │     ask_gold_guide     │  │    ltft_calculator     │  │  get_current_datetime  │
   │       (Sub-Agent)      │  │         (Tool)         │  │         (Tool)         │
   └────────┬───────────────┘  └────────────────────────┘  └────────────────────────┘
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

## Project Structure (WIP)

```text
src/
├── agent/                  # Core orchestrator agent loop + types
│   ├── agent.ts            # Agent class (interactive + programmatic chat)
│   ├── constants.ts        # System prompts, config constants
│   ├── types.ts            # Provider-agnostic message/tool interfaces
│   └── index.ts
├── providers/              # Model provider adapters
│   ├── anthropic.ts        # Anthropic direct API
│   ├── bedrock.ts          # AWS Bedrock Converse API
│   └── provider-factory.ts
├── tools/                  # Orchestrator tools
│   ├── datetime.tool.ts
│   ├── ltft-calculator.tool.ts
│   └── gold-guide-expert.tool.ts   # Re-exports from gold-guide-expert/sub-agent
├── utils/
│   ├── colours.ts
│   └── normalize-stop-reason.ts
├── main.ts                 # Interactive CLI entry point
└── input-handler.ts        # Readline-based CLI input

gold-guide-expert/          # Self-contained Gold Guide domain module
├── core/                   # Shared library (stateless, no agent concerns)
│   ├── types.ts            # PipelineConfig, GoldGuideResult, Citation, etc.
│   ├── pipeline-registry.ts # Single source of truth for all pipeline configs
│   ├── query-gold-guide.ts # queryGoldGuide() — shared entry point
│   ├── retrieval/          # Pluggable retrieval pipeline implementations
│   │   ├── cag-pipeline.ts
│   │   ├── rag-pipeline.ts
│   │   └── hybrid-pipeline.ts
│   └── index.ts
├── evaluation/             # Test harness (imports core/)
│   ├── types.ts            # QAItem, ScoredResult, EvalRunSummary, etc.
│   ├── config.ts           # Dataset loader + eval pipeline ID aliases
│   ├── runner.ts           # Batch loop: reads QA set → queryGoldGuide → judge
│   ├── judge.ts            # LLM-as-judge scoring
│   ├── metrics.ts          # Aggregate metric computation
│   └── index.ts
├── sub-agent/              # Production wrapper (imports core/)
│   ├── gold-guide-sub-agent.ts  # Conversation-aware wrapper + PRODUCTION_CONFIG
│   ├── tool-definition.ts       # ToolDefinition for the Orchestrator
│   └── index.ts
├── data/                   # Non-code assets
│   ├── raw/                # Original Gold Guide PDF
│   ├── markdown/           # Parsed + canonicalised markdown
│   └── qa/                 # QA datasets (development, frozen, stress)
└── docs/                   # Research & planning documents
```

### Key design: shared `queryGoldGuide()`

```text
src/tools/gold-guide-expert.tool.ts     →  gold-guide-expert/sub-agent/
gold-guide-expert/sub-agent/            →  gold-guide-expert/core/queryGoldGuide()
gold-guide-expert/evaluation/runner.ts  →  gold-guide-expert/core/queryGoldGuide()
```

Both the production sub-agent and the evaluation harness will call the same stateless
`queryGoldGuide(question, config)` function. Pipeline configs are managed in a
central registry (`core/pipeline-registry.ts`) — the production config is just a
pointer to the evaluation winner.

## Quick Start

NOTE: This project is still very much a WIP e.g. no "Gold Guide expert", no evaluation harness infra etc.

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys and model choice

# Interactive mode (Orchestrator with all tools)
npm run dev

# Run evaluation harness
npm run eval
```

## Environment Variables (WIP)

| Variable            | Required     | Description              |
| ------------------- | ------------ | ------------------------ |
| `AI_PROVIDER`       | Yes          | `anthropic` or `bedrock` |
| `ANTHROPIC_API_KEY` | If anthropic | API key                  |
| `ANTHROPIC_MODEL`   | If anthropic | Model ID                 |
| `BEDROCK_MODEL`     | If bedrock   | Bedrock model ID         |
| `AWS_REGION`        | If bedrock   | AWS region               |

Note: Still WIP, e.g. no Bedrock implementation yet so just best guess; and we can/will add more model providers to test.

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
