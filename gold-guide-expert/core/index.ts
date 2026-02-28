export { queryGoldGuide } from "./query-gold-guide.js";

export type {
  PipelineConfig,
  GoldGuideResult,
  Citation,
  RetrievedChunk,
  RetrievalPipeline
} from "./types.js";

export { RetrievalError, ContextExhaustionError } from "./errors.js";

// Pipeline implementations (for e.g. direct testing)
export { CagPipeline, RagPipeline, HybridPipeline } from "./retrieval/index.js";
