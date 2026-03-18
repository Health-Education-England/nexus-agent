/**
 * Core types for the Gold Guide MCP server.
 *
 * Slimmed from the root gold-guide-expert/core/types.ts:
 * - Removed PipelineConfig (CAG is hardcoded here)
 * - Removed EmbeddingProvider / VectorStore (RAG not used here)
 */

export type RetrievedChunk = {
  /** Canonical paragraph ID, e.g. "1.15 i" */
  canonicalId: string;
  /** Paragraph text */
  content: string;
  /** Similarity score (1 for CAG — all chunks equally "retrieved") */
  score: number;
  metadata?: Record<string, unknown>;
};

export type Citation = {
  canonicalId: string;
  sectionRef?: string;
  sourceText?: string;
};

export type GoldGuideResult = {
  answer: string;
  citations: Citation[];
  retrievedChunks: RetrievedChunk[];
  pipelineUsed: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  latencyMs: number;
};
