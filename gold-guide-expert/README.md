# Gold Guide Expert

This module contains the Gold Guide retrieval/evaluation stack used by `nexus-agent`.

## What’s Implemented

- **Shared query core** via `core/query-gold-guide.ts` (`queryGoldGuide`) used by both:
  - production sub-agent wrapper
  - evaluation harness
- **CAG retrieval baseline** in `core/retrieval/cag-pipeline.ts` loading canonical JSONL chunks.
- **Naive RAG pipeline** in `core/retrieval/rag-pipeline.ts`:
  - Embeds queries via Ollama (`qwen3-embedding:8b`, 4096d native → 1024d output via Matryoshka truncation)
  - Vector search against Qdrant (Docker)
  - Returns top-k chunks for LLM synthesis
- **Per-task model configuration** via `PipelineConfig.models` object:
  - `answer` — synthesises from context (always required)
  - `judge` — LLM-as-judge during evaluation (defaults to `answer`)
  - `embedding` — embedding model for RAG retrieval (e.g. `qwen3-embedding:8b`)
  - `reranker` — reserved for hybrid RAG pipeline
- **Evaluation harness** in `evaluation/runner.ts`:
  - dataset loading + validation
  - pipeline alias selection
  - batch run + artifact output
  - aggregate metrics
- **LLM-as-judge** in `evaluation/judge.ts` scoring correctness, completeness,
  citation precision, and hallucination severity.
- **Multi-provider support**: Anthropic (direct API), Bedrock (scaffolded), and **Ollama** (local models) — any LLM role (orchestrator, answer, judge) can run on any provider.
- **Model override controls** from CLI for cost/performance experiments.
- **Anthropic models list utility** with JSON artifact output.

## Evaluation Commands

### Baseline run

```bash
npm run -s eval:cag
```

### Cost-controlled run (single item)

```bash
npm run -s eval:cag -- --limit 1
```

### Swap answer model at runtime

```bash
npm run -s eval:cag -- --limit 1 --model claude-haiku-4-5-20251001
```

### Separate answer vs judge models

```bash
npm run -s eval:cag -- --limit 1 --model claude-haiku-4-5-20251001 --judge-model claude-haiku-4-5-20251001
```

### Useful filters

```bash
# specific question ID
npm run -s eval:cag -- --id dev-001

# pipeline alias
npm run -s eval:cag -- --pipeline cagCheap
```

### Local model evaluation (Ollama)

All pipeline roles (answer synthesis, judge) can run on a local Ollama model
for zero-cost experimentation:

```bash
# Pull a chat model first
ollama pull qwen3.5:9b

# CAG with local model
npm run -s eval:cag -- --pipeline cagLocal --limit 1

# Naive RAG with local model
npm run -s eval:cag -- --pipeline naiveRagLocal --limit 1

# Override just the answer model to local, keep cloud judge
npm run -s eval:cag -- --model qwen3.5:9b
```

Available local pipeline aliases: `cagLocal`, `naiveRagLocal`, `hybridRagLocal`.
These use `qwen3.5:9b` by default — swap the model in `evaluation/pipeline-registry.ts`.

## LLM-as-Judge

All evaluation runs use an LLM judge. Each scored item includes `judgeMeta`:

- optional `confidence`, `rationale`
- `error` (only when the judge encountered a problem)

Human domain-expert review happens later as a separate step.

## Runtime Model Provenance in Artifacts

Evaluation artifacts include an `effectiveModels` block:

- `answer`
- `judge`
- `answerOverridden`
- `judgeOverridden`

When no `--judge-model` override is provided, the judge defaults to the
pipeline's `models.judge` and then to `models.answer`.

## Output Locations

### Evaluation artifacts

Written to:

- `gold-guide-expert/evaluation/results/evaluation-results-*.json`

### Anthropic model list artifacts

List models and save output:

```bash
npm run -s models:list:anthropic -- --limit 20
```

Written by default to:

- `gold-guide-expert/data/metadata/anthropic-models.json`

Optional pagination args:

- `--after-id <model_id>`
- `--before-id <model_id>`
- `--out <custom-path>`

## RAG Infrastructure

The naive RAG pipeline uses local infrastructure:

- **Embedding model**: [qwen3-embedding:8b](https://ollama.com/library/qwen3-embedding:8b) (4096d native, truncated to 1024d via Matryoshka Representation Learning) via [Ollama](https://ollama.com/)
- **Vector database**: [Qdrant](https://qdrant.tech/) running in Docker
- **Abstraction layer**: Provider-agnostic `EmbeddingProvider` and `VectorStore` interfaces in `core/types.ts` — swap implementations without changing pipeline code

### Prerequisites

- [Docker](https://www.docker.com/) installed and running
- [Ollama](https://ollama.com/) installed and running

### Setup (one-time)

```bash
# 1. Pull the embedding model (~4.7GB download)
ollama pull qwen3-embedding:8b

# 2. Start the Qdrant vector database
npm run rag:services:up

# 3. Ingest canonical chunks into the vector store (498 chunks)
npm run rag:ingest
```

The ingestion script reads `data/raw/gold_guide_canonical.jsonl`, embeds each chunk
via Ollama, and upserts them into Qdrant. It's idempotent — if the collection already
has data it will skip unless you pass `--force`.

### Ingestion options

```bash
# Re-ingest (overwrite existing data)
npm run rag:ingest -- --force

# Use a different embedding model
npm run rag:ingest -- --model mxbai-embed-large

# Use different output dimensions (Matryoshka models only)
npm run rag:ingest -- --dims 512

# Use a different collection name
npm run rag:ingest -- --collection my-collection
```

### Managing vector store

```bash
# Start Qdrant
npm run rag:services:up

# Stop Qdrant (data persists in Docker volume)
npm run rag:services:down

# Stop and delete all data
docker compose down -v
```

### Environment variables (optional)

| Variable          | Default                  | Description                                   |
| ----------------- | ------------------------ | --------------------------------------------- |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API URL (shared by chat and embedding) |
| `OLLAMA_MODEL`    | —                        | Chat model for AI_PROVIDER=ollama             |
| `OLLAMA_NUM_CTX`  | `8192`                   | Context window size for Ollama chat models    |
| `QDRANT_URL`      | `http://localhost:6333`  | Qdrant REST API URL                           |
| `QDRANT_PORT`     | `6333`                   | Host port mapping in Docker Compose           |

### RAG evaluation commands

```bash
# Run full dev set through naive RAG (Sonnet answer model)
npm run -s eval:rag

# Single question quick test
npm run -s eval:rag -- --limit 1

# Use the cheap Haiku answer model
npm run -s eval:cag -- --pipeline naiveRagCheap

# Specific question
npm run -s eval:cag -- --pipeline naiveRag --id dev-001
```

### Architecture

```text
User query
  │
  ▼
RagPipeline.retrieve()
  ├── 1. Embed query       →  OllamaEmbeddingProvider  →  Ollama HTTP API
  ├── 2. Vector search     →  QdrantVectorStore         →  Qdrant REST API
  └── 3. Return top-k RetrievedChunk[]
  │
  ▼
queryGoldGuide()  ←  same as CAG from here on
  ├── Build prompt with retrieved context
  ├── Call LLM (Anthropic / Bedrock / Ollama)
  └── Extract citations → GoldGuideResult
```

The `EmbeddingProvider` and `VectorStore` interfaces in `core/types.ts` are
deliberately provider-agnostic. To swap Qdrant for another vector DB (e.g.
LanceDB, Pgvector) or Ollama for a cloud embedding API (e.g. Gemini),
implement the interface and update the factory in the corresponding `index.ts`.

## Notes on Current Scope

- CAG path is implemented and runnable.
- Naive RAG pipeline is implemented and runnable (requires Ollama + Qdrant).
- Hybrid RAG pipeline is scaffolded but not yet implemented.
- LLM judge is useful but not perfect; use `judgeMeta.rationale` and SME (Subject Matter Expert e.g. Dean/LO rep) manual review for close calls.
