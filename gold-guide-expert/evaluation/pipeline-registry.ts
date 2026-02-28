/**
 * Pipeline Registry
 *
 * Single source of truth for all tested pipeline configurations.
 * Used primarily by the evaluation harness.
 *
 * Naming convention:  {pipeline}-{model}-{provider}[-{variant}]
 * Add new entries as you test new combinations during evaluation.
 */

import type { PipelineConfig } from "../core/types.js";

export const PIPELINE_REGISTRY = {
  // ── CAG configs (testing-phase step 5) ──

  "cag-sonnet-anthropic": {
    pipeline: "cag",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic"
  },

  // "cag-gemini-flash": {
  //   pipeline: "cag",
  //   model: "gemini-2.0-flash",
  //   provider: "...",          // add when provider support exists
  // },

  // ── Naive RAG configs (testing-phase step 6) ──

  "naive-rag-sonnet-anthropic": {
    pipeline: "naive-rag",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    topK: 5,
    chunkSize: 2000,
    chunkOverlap: 200
  },

  // ── Hybrid RAG configs (testing-phase step 7) ──

  "hybrid-rag-sonnet-anthropic": {
    pipeline: "hybrid-rag",
    model: "claude-sonnet-4-20250514",
    provider: "anthropic",
    topK: 5,
    chunkSize: 2000,
    chunkOverlap: 200
  }
} as const satisfies Record<string, PipelineConfig>;

/** All registered pipeline IDs */
export type PipelineId = keyof typeof PIPELINE_REGISTRY;

/**
 * Helper to look up a config by ID with a runtime check.
 */
export function getPipelineConfig(id: PipelineId): PipelineConfig {
  const config = PIPELINE_REGISTRY[id];
  if (!config) {
    throw new Error(`Unknown pipeline ID: "${id}". Check PIPELINE_REGISTRY.`);
  }
  return config;
}
