/**
 * Naive RAG (Retrieval-Augmented Generation) Pipeline
 *
 * Intent:
 * A baseline retrieval approach relying purely on vector embeddings
 * and similarity search (embed query → ANN search → return top-k).
 *
 * Architectural Role:
 * Serves as the first step away from pure CAG (Step 6 of the test plan).
 * Its main purpose is to compare cost, latency, and citation accuracy
 * against the CAG baseline to prove the ROI of vector search and pinpoint
 * missing vocabulary gaps.
 *
 * Infrastructure:
 *   - Embedding:    Ollama + qwen3-embedding:8b (local, 4096d native → 1024d output)
 *   - Vector store: Qdrant (Docker)
 *
 * Before using this pipeline, ensure:
 *   1. Ollama is running with the model pulled:  ollama pull qwen3-embedding:8b
 *   2. Qdrant is running:                        docker compose up -d
 *   3. Chunks have been ingested:                 npm run rag:ingest
 */

import type {
  RetrievalPipeline,
  RetrievedChunk,
  PipelineConfig
} from "../types.js";
import { getEmbeddingProvider } from "./embeddings/index.js";
import { getVectorStore } from "./vector-store/index.js";

const DEFAULT_TOP_K = 5;
const DEFAULT_COLLECTION = "gold-guide";

export class RagPipeline implements RetrievalPipeline {
  readonly name = "naive-rag" as const;

  async retrieve(
    query: string,
    config: PipelineConfig
  ): Promise<RetrievedChunk[]> {
    const embeddingModel = config.models.embedding ?? "qwen3-embedding:8b";
    const collection = config.vectorCollection ?? DEFAULT_COLLECTION;
    const topK = config.topK ?? DEFAULT_TOP_K;
    const embeddingDimensions = config.embeddingDimensions;

    const embedder = getEmbeddingProvider(embeddingModel, {
      outputDimensions: embeddingDimensions
    });
    const store = getVectorStore();

    const info = await store.collectionInfo(collection);
    if (!info.exists || info.pointCount === 0) {
      throw new Error(
        `Vector collection '${collection}' is empty or does not exist. ` +
          `Run 'npm run rag:ingest' first.`
      );
    }

    const [queryVector] = await embedder.embed([query]);

    // Search for nearest neighbours
    const results = await store.search(collection, queryVector, topK);

    // Map to RetrievedChunk
    return results.map(hit => ({
      canonicalId: (hit.payload.canonicalId as string) ?? hit.id,
      content: (hit.payload.content as string) ?? "",
      score: hit.score,
      metadata: Object.fromEntries(
        Object.entries(hit.payload).filter(
          ([key]) => key !== "canonicalId" && key !== "content"
        )
      )
    }));
  }
}
