import type { PipelineConfig } from "../core/types.js";

/**
 * The ID of the pipeline currently running in production.
 */
export const PRODUCTION_PIPELINE_ID = "cag-sonnet-anthropic";

/**
 * Hardcoded production configuration.
 * This prevents the production sub-agent from needing to load
 * dozens of experimental evaluation configs into memory.
 */
export const PRODUCTION_CONFIG: PipelineConfig = {
  pipeline: "cag",
  model: "claude-sonnet-4-20250514",
  provider: "anthropic"
};
