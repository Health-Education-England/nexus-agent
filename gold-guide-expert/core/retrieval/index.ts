/**
 * Retrieval Pipelines Registry
 * 
 * Intent:
 * Exports all available retrieval pipelines and a factory map to instantiate them.
 * 
 * Architectural Role:
 * Decouples the strategy selection from the overarching query handler.
 * Allows the test harness or sub-agent to dynamically switch between 
 * 'cag', 'naive-rag', and 'hybrid-rag' at runtime via the PipelineConfig.
 */

export { CagPipeline } from "./cag-pipeline.js";
export { RagPipeline } from "./rag-pipeline.js";
export { HybridPipeline } from "./hybrid-pipeline.js";

import { CagPipeline } from "./cag-pipeline.js";
import { RagPipeline } from "./rag-pipeline.js";
import { HybridPipeline } from "./hybrid-pipeline.js";
import type { RetrievalPipeline } from "../types.js";

export const PIPELINE_FACTORIES: Record<string, () => RetrievalPipeline> = {
  cag: () => new CagPipeline(),
  "naive-rag": () => new RagPipeline(),
  "hybrid-rag": () => new HybridPipeline()
};
