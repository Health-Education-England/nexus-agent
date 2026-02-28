// ── Gold Guide Core Types ──
// Shared types for the queryGoldGuide function and retrieval pipelines.

/**
 * Configuration passed to queryGoldGuide to select which pipeline
 * and model to use. The evaluation harness and sub-agent each
 * construct their own PipelineConfig.
 */
export type PipelineConfig = {
  pipeline: "cag" | "naive-rag" | "hybrid-rag";

  model: string;

  provider: "anthropic" | "bedrock";

  // RAG only options
  topK?: number;
  chunkSize?: number;
  chunkOverlap?: number;
};

export type Citation = {
  /** Immutable canonical GG ID, e.g. "GG10|p42|4.2.1|s2" */
  canonicalId: string;

  /** Human-readable section reference, e.g. "Section 4.2.1" */
  sectionRef?: string;

  /** The verbatim source text that supports the answer */
  sourceText?: string;
};

/**
 * A chunk of text retrieved by a retrieval pipeline, before
 * it is sent to the LLM for synthesis/answer generation.
 */
export type RetrievedChunk = {
  canonicalId: string;

  content: string;

  // Relevance score from the retrieval step (e.g., cosine similarity, BM25 score, etc.)
  score: number;

  // Optional metadata (page number, heading hierarchy, etc.)
  metadata?: Record<string, unknown>;
};

/**
 * The structured result returned by queryGoldGuide.
 * Contains everything both the evaluation harness and
 * the production sub-agent need.
 */
export type GoldGuideResult = {
  // The generated answer text
  answer: string;

  citations: Citation[];

  // The chunks that were retrieved and sent to the LLM (empty for CAG cos whole doc is sent)
  retrievedChunks: RetrievedChunk[];

  pipelineUsed: PipelineConfig["pipeline"];

  // Token usage breakdown
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  // Total latency of the queryGoldGuide call (retrieval + LLM time)
  latencyMs: number;
};

/**
 * Common interface that every retrieval pipeline implements.
 * queryGoldGuide picks the right pipeline based on PipelineConfig
 * and calls retrieve() to get the context chunks.
 */
export type RetrievalPipeline = {
  readonly name: PipelineConfig["pipeline"];

  /**
   * Given a user query, return the most relevant chunks
   * from the Gold Guide source text.
   */
  retrieve(query: string, config: PipelineConfig): Promise<RetrievedChunk[]>;
};
