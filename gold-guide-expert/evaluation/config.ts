/**
 * Evaluation Config
 *
 * Helpers for loading QA datasets and constructing PipelineConfigs
 * for evaluation runs.
 *
 * Pipeline configs now live in the shared registry (core/pipeline-registry.ts).
 * This file re-exports convenient aliases and handles dataset loading.
 */

import type { PipelineId } from "./pipeline-registry.js";
import type { QAItem } from "./types.js";

/**
 * Load a QA dataset from the data/qa/ directory.
 *
 * @param name - Dataset name: "development", "frozen", or "stress"
 */
export async function loadDataset(name: string): Promise<QAItem[]> {
  // TODO: Read from gold-guide-expert/data/qa/{name}.json
  throw new Error(`loadDataset("${name}") is not yet implemented.`);
}

/**
 * Convenience aliases mapping testing-phase steps to registry IDs.
 *
 * These point into PIPELINE_REGISTRY — no duplicated config values.
 * Add new aliases as you test new combinations.
 */
export const EVAL_PIPELINE_IDS = {
  /** CAG baseline — testing-phase step 5 */
  cagBaseline: "cag-sonnet-anthropic",

  /** Naive RAG — testing-phase step 6 */
  naiveRag: "naive-rag-sonnet-anthropic",

  /** Hybrid RAG — testing-phase step 7 */
  hybridRag: "hybrid-rag-sonnet-anthropic"
} as const satisfies Record<string, PipelineId>;

/** Re-export the full registry and lookup helper for direct use */
export { PIPELINE_REGISTRY, getPipelineConfig } from "./pipeline-registry.js";
export type { PipelineId } from "./pipeline-registry.js";
