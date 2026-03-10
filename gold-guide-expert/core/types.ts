// ── Gold Guide Core Types ──
// Shared types for the queryGoldGuide function and retrieval pipelines.

/**
 * Configuration passed to queryGoldGuide to select which pipeline
 * and model to use. The evaluation harness and sub-agent each
 * construct their own PipelineConfig.
 */
export type PipelineConfig = {
  pipeline: "cag" | "naive-rag" | "hybrid-rag";

  /** Provider for the answer/judge LLM. */
  provider: "anthropic" | "bedrock" | "ollama";

  /**
   * Models used for each task in the pipeline.
   *
   * - `answer`    — synthesises the response from retrieved context (always required)
   * - `judge`     — LLM-as-judge during evaluation (defaults to `answer` if omitted)
   * - `embedding` — embedding model for RAG retrieval (e.g. "qwen3-embedding:8b")
   * - `reranker`  — re-ranking model for hybrid RAG (future)
   */
  models: {
    answer: string;
    judge?: string;
    embedding?: string;
    reranker?: string;
  };

  // RAG-only options
  topK?: number;
  chunkSize?: number;
  chunkOverlap?: number;

  /**
   * Output embedding dimensions for Matryoshka-capable models.
   * Vectors are truncated from the model's native dimension and L2-normalised.
   * Must match the dimension used during ingestion.
   * Defaults to 1024 if omitted.
   */
  embeddingDimensions?: number;

  /**
   * Qdrant collection name for vector-based pipelines.
   * Defaults to "gold-guide" if omitted.
   */
  vectorCollection?: string;
};

// ── Embedding Provider ──

/**
 * Provider-agnostic interface for text embedding.
 * Implementations: OllamaEmbeddingProvider (local), future: Gemini, Voyage, etc.
 */
export type EmbeddingProvider = {
  /** Embed one or more texts into dense vectors. */
  embed(texts: string[]): Promise<number[][]>;

  /** Dimensionality of the embedding vectors. */
  readonly dimensions: number;

  /** Model identifier (e.g. "nomic-embed-text"). */
  readonly modelName: string;
};

// ── Vector Store ──

export type VectorDocument = {
  id: string | number;
  vector: number[];
  payload: Record<string, unknown>;
};

export type VectorSearchResult = {
  id: string;
  score: number;
  payload: Record<string, unknown>;
};

/**
 * Provider-agnostic interface for vector storage and retrieval.
 * Implementations: QdrantVectorStore (Docker), future: LanceDB, Pgvector, etc.
 */
export type VectorStore = {
  /**
   * Ensure a collection exists with the given dimensions.
   * No-op if it already exists with matching config.
   */
  ensureCollection(name: string, dimensions: number): Promise<void>;

  /** Upsert documents into a collection. */
  upsert(collection: string, documents: VectorDocument[]): Promise<void>;

  /** Search for the top-k nearest neighbours. */
  search(
    collection: string,
    vector: number[],
    topK: number
  ): Promise<VectorSearchResult[]>;

  /** Check if a collection exists and has points. */
  collectionInfo(
    collection: string
  ): Promise<{ exists: boolean; pointCount: number }>;
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
