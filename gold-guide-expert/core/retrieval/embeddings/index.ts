/**
 * Embedding Providers — factory + singleton cache.
 *
 * Usage:
 *   const embedder = getEmbeddingProvider("qwen3-embedding:8b", { outputDimensions: 1024 });
 *   const vectors = await embedder.embed(["hello world"]);
 */

export { OllamaEmbeddingProvider } from "./ollama-embedding.js";
export type { OllamaEmbeddingOptions } from "./ollama-embedding.js";

import type { EmbeddingProvider } from "../../types.js";
import { OllamaEmbeddingProvider } from "./ollama-embedding.js";

const DEFAULT_MODEL = "qwen3-embedding:8b";
const DEFAULT_OUTPUT_DIMENSIONS = 1024;

/** Cached singletons keyed by "model:dimensions". */
const instances = new Map<string, EmbeddingProvider>();

/**
 * Get (or create) an EmbeddingProvider for the given model.
 * Currently all models route to Ollama. Extend this factory
 * when adding Gemini, Voyage, etc.
 */
export function getEmbeddingProvider(
  modelName?: string,
  options?: { baseUrl?: string; outputDimensions?: number }
): EmbeddingProvider {
  const model = modelName ?? DEFAULT_MODEL;
  const dims = options?.outputDimensions ?? DEFAULT_OUTPUT_DIMENSIONS;
  const cacheKey = `${model}:${dims}`;

  const cached = instances.get(cacheKey);
  if (cached) return cached;

  // For now, all embedding models go through Ollama.
  // Future: branch on model prefix to select provider.
  const provider = new OllamaEmbeddingProvider({
    model,
    baseUrl: options?.baseUrl ?? process.env.OLLAMA_BASE_URL,
    outputDimensions: dims
  });

  instances.set(cacheKey, provider);
  return provider;
}
