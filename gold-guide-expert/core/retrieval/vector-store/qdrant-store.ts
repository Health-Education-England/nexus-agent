/**
 * Qdrant Vector Store
 *
 * Talks to a Qdrant instance (typically Docker) via the official
 * REST client. Implements the provider-agnostic VectorStore interface.
 *
 * Requires: docker compose up -d (runs Qdrant on localhost:6333)
 * Dependency: @qdrant/js-client-rest
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import type {
  VectorStore,
  VectorDocument,
  VectorSearchResult
} from "../../types.js";

export class QdrantVectorStore implements VectorStore {
  private readonly client: QdrantClient;

  constructor(options?: { url?: string; apiKey?: string }) {
    this.client = new QdrantClient({
      url: options?.url ?? process.env.QDRANT_URL ?? "http://localhost:6333",
      apiKey: options?.apiKey
    });
  }

  async ensureCollection(name: string, dimensions: number): Promise<void> {
    const exists = await this.client
      .getCollection(name)
      .then(() => true)
      .catch(() => false);

    if (exists) return;

    await this.client.createCollection(name, {
      vectors: {
        size: dimensions,
        distance: "Cosine"
      }
    });
  }

  async upsert(collection: string, documents: VectorDocument[]): Promise<void> {
    if (documents.length === 0) return;

    await this.client.upsert(collection, {
      wait: true,
      points: documents.map(doc => ({
        id: doc.id,
        vector: doc.vector,
        payload: doc.payload
      }))
    });
  }

  async search(
    collection: string,
    vector: number[],
    topK: number
  ): Promise<VectorSearchResult[]> {
    const results = await this.client.search(collection, {
      vector,
      limit: topK,
      with_payload: true
    });

    return results.map(hit => ({
      id: typeof hit.id === "string" ? hit.id : String(hit.id),
      score: hit.score,
      payload: (hit.payload ?? {}) as Record<string, unknown>
    }));
  }

  async collectionInfo(
    collection: string
  ): Promise<{ exists: boolean; pointCount: number }> {
    try {
      const info = await this.client.getCollection(collection);
      return {
        exists: true,
        pointCount: info.points_count ?? 0
      };
    } catch {
      return { exists: false, pointCount: 0 };
    }
  }
}
