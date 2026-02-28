/**
 * Cache-Augmented Generation (CAG) Pipeline
 *
 * Intent:
 * This pipeline implements the CAG strategy where the entire Gold Guide
 * document is injected into the LLM context window. It skips traditional
 * vector chunk retrieval entirely.
 *
 * Architectural Role:
 * Used primarily to establish an "LLM reasoning baseline" (Step 5 of the test plan).
 * By providing the full text, we isolate LLM reasoning failures from
 * retrieval failures. If the LLM fails with CAG, the problem is understanding
 * the policy; if it succeeds here but fails in RAG, the problem is our retrieval.
 */

import type {
  RetrievalPipeline,
  RetrievedChunk,
  PipelineConfig
} from "../types.js";

export class CagPipeline implements RetrievalPipeline {
  readonly name = "cag" as const;

  async retrieve(
    _query: string,
    _config: PipelineConfig
  ): Promise<RetrievedChunk[]> {
    // For CAG, we bypass granular retrieval and load the whole canonicalised
    // markdown document. It may be returned as a single massive chunk or
    // handled entirely by the prompt builder fetching the cached document.
    throw new Error("CagPipeline.retrieve() not yet implemented.");
  }
}
