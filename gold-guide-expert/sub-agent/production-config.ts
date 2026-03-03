import type { PipelineConfig } from "../core/types.js";

/**
 * The ID of the pipeline currently running in production.
 */
export const PRODUCTION_PIPELINE_ID = "cag-sonnet-anthropic";

/**
 * Hardcoded production configuration.
 * This prevents the production sub-agent from needing to load
 * dozens of experimental evaluation configs into memory.
 *
 * Note: the orchestrator model is configured separately via env vars.
 * This config only governs the Gold Guide sub-agent pipeline.
 *
 * Only `answer` is needed here — the judge model is only used
 * during evaluation and is configured in pipeline-registry.ts.
 */
export const PRODUCTION_CONFIG: PipelineConfig = {
  pipeline: "cag",
  provider: "anthropic",
  models: {
    answer: "claude-haiku-4-5-20251001"
  }
};
