/**
 * Ollama Embedding Provider
 *
 * Calls the local Ollama HTTP API to generate dense vector embeddings.
 * Requires Ollama running locally with the target model pulled:
 *
 *   ollama pull qwen3-embedding
 *
 * Supports Matryoshka-style dimension reduction: models that output high-
 * dimensional vectors (e.g. qwen3-embedding → 4096d) can be truncated to
 * a smaller dimension (e.g. 1024d) with L2 normalisation, which is the
 * standard approach for Matryoshka Representation Learning models.
 *
 * API docs: https://github.com/ollama/ollama/blob/main/docs/api.md#generate-embeddings
 */

import type { EmbeddingProvider } from "../../types.js";
import { formatErrorCauseSuffix } from "../../errors.js";

/**
 * Known models and their native (full) embedding dimensions.
 * Extend this map as you add new Ollama embedding models.
 */
const MODEL_NATIVE_DIMENSIONS: Record<string, number> = {
  "qwen3-embedding": 4096,
  "qwen3-embedding:8b": 4096,
  "qwen3-embedding:4b": 4096,
  "qwen3-embedding:0.6b": 4096,
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
  "all-minilm": 384
};

const DEFAULT_MODEL = "qwen3-embedding:8b";

type OllamaEmbedResponse = {
  model: string;
  embeddings: number[][];
};

export type OllamaEmbeddingOptions = {
  /** Ollama model name (default: qwen3-embedding:8b) */
  model?: string;

  /** Ollama base URL (default: http://localhost:11434) */
  baseUrl?: string;

  /**
   * Desired output dimensions. For Matryoshka-capable models (e.g.
   * qwen3-embedding) this truncates the native output and L2-normalises.
   * Must be ≤ the model's native dimension.
   * If omitted, uses the model's native dimension.
   */
  outputDimensions?: number;
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;

  private readonly baseUrl: string;
  private readonly nativeDimensions: number;
  private readonly shouldTruncate: boolean;

  constructor(options?: OllamaEmbeddingOptions) {
    this.modelName = options?.model ?? DEFAULT_MODEL;
    this.baseUrl = options?.baseUrl ?? "http://localhost:11434";

    const nativeDims = MODEL_NATIVE_DIMENSIONS[this.modelName];
    if (!nativeDims) {
      throw new Error(
        `Unknown embedding model '${this.modelName}'. ` +
          `Known models: ${Object.keys(MODEL_NATIVE_DIMENSIONS).join(", ")}. ` +
          `Add the model and its native dimensions to MODEL_NATIVE_DIMENSIONS in ollama-embedding.ts.`
      );
    }
    this.nativeDimensions = nativeDims;

    const requestedDims = options?.outputDimensions;
    if (requestedDims === undefined) {
      this.dimensions = nativeDims;
      this.shouldTruncate = false;
    } else {
      if (requestedDims < 1 || requestedDims > nativeDims) {
        throw new Error(
          `outputDimensions (${requestedDims}) must be between 1 and ${nativeDims} for model '${this.modelName}'.`
        );
      }
      this.dimensions = requestedDims;
      this.shouldTruncate = requestedDims < nativeDims;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.modelName,
          input: texts
        }),
        signal: AbortSignal.timeout(120_000) // 2 min for model load + embedding
      });
    } catch (fetchError) {
      const cause = formatErrorCauseSuffix(fetchError, " (", ")");
      throw new Error(
        `Ollama embed fetch failed for ${this.baseUrl}/api/embed${cause}\n` +
          `Is Ollama running? Have you pulled the model? (ollama pull ${this.modelName})`,
        { cause: fetchError }
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(no body)");
      throw new Error(
        `Ollama embed request failed (${response.status}): ${errorBody}\n` +
          `Is Ollama running? Have you pulled the model? (ollama pull ${this.modelName})`
      );
    }

    const data = (await response.json()) as OllamaEmbedResponse;

    if (data.embeddings?.length !== texts.length) {
      throw new Error(
        `Ollama returned ${data.embeddings?.length ?? 0} embeddings for ${texts.length} inputs.`
      );
    }

    if (!this.shouldTruncate) {
      return data.embeddings;
    }

    // Matryoshka truncation: take first N dims → L2 normalise
    return data.embeddings.map(vec => this.truncateAndNormalize(vec));
  }

  /**
   * Truncate a vector to `this.dimensions` and L2-normalise.
   * Standard practice for Matryoshka Representation Learning models.
   */
  private truncateAndNormalize(vector: number[]): number[] {
    const truncated = vector.slice(0, this.dimensions);

    let norm = 0;
    for (const v of truncated) {
      norm += v * v;
    }
    norm = Math.sqrt(norm);

    if (norm === 0) return truncated;
    return truncated.map(v => v / norm);
  }
}
