# Gold Guide Expert

This module contains the Gold Guide retrieval/evaluation stack used by `nexus-agent`.

## What’s Implemented

- **Shared query core** via `core/query-gold-guide.ts` (`queryGoldGuide`) used by both:
  - production sub-agent wrapper
  - evaluation harness
- **CAG retrieval baseline** in `core/retrieval/cag-pipeline.ts` loading canonical JSONL chunks.
- **Per-task model configuration** via `PipelineConfig.models` object:
  - `answer` — synthesises from context (always required)
  - `judge` — LLM-as-judge during evaluation (defaults to `answer`)
  - `embedding` / `reranker` — reserved for RAG pipelines
- **Evaluation harness** in `evaluation/runner.ts`:
  - dataset loading + validation
  - pipeline alias selection
  - batch run + artifact output
  - aggregate metrics
- **LLM-as-judge** in `evaluation/judge.ts` scoring correctness, completeness,
  citation precision, and hallucination severity.
- **Model override controls** from CLI for cost/performance experiments.
- **Anthropic models list utility** with JSON artifact output.

## Evaluation Commands

### Baseline run

```bash
npm run -s eval:dev
```

### Cost-controlled run (single item)

```bash
npm run -s eval:dev -- --limit 1
```

### LLM judge (always active)

```bash
npm run -s eval:dev -- --limit 1
```

### Swap answer model at runtime

```bash
npm run -s eval:dev -- --limit 1 --model claude-haiku-4-5-20251001
```

### Separate answer vs judge models

```bash
npm run -s eval:dev -- --limit 1 --model claude-haiku-4-5-20251001 --judge-model claude-haiku-4-5-20251001
```

### Useful filters

```bash
# specific question ID
npm run -s eval:dev -- --id dev-001

# pipeline alias
npm run -s eval:dev -- --pipeline cagCheap
```

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

## Notes on Current Scope

- CAG path is implemented and runnable.
- Naive/hybrid RAG aliases are scaffolded for comparative testing.
- LLM judge is useful but not perfect; use `judgeMeta.rationale` and SME (Subject Matter Expert e.g. Dean/LO rep) manual review for close calls.
