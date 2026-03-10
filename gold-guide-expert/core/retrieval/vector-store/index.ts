/**
 * Vector Store — factory + singleton cache.
 *
 * Usage:
 *   const store = getVectorStore();
 *   await store.ensureCollection("gold-guide", 768);
 *   const results = await store.search("gold-guide", queryVector, 5);
 */

export { QdrantVectorStore } from "./qdrant-store.js";

import type { VectorStore } from "../../types.js";
import { QdrantVectorStore } from "./qdrant-store.js";

let instance: VectorStore | undefined;

/**
 * Get (or create) the VectorStore singleton.
 * Currently always returns Qdrant. Extend this factory
 * when adding LanceDB, Pgvector, etc.
 */
export function getVectorStore(options?: {
  url?: string;
  apiKey?: string;
}): VectorStore {
  if (instance) return instance;

  instance = new QdrantVectorStore({
    url: options?.url ?? process.env.QDRANT_URL,
    apiKey: options?.apiKey
  });

  return instance;
}
