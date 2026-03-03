// ── Gold Guide Testing/Evaluation Harness

export { runEvaluation } from "./runner.js";
export { judge } from "./judge.js";
export type { JudgeOptions } from "./judge.js";
export { computeMetrics } from "./metrics.js";
export {
  loadDataset,
  EVAL_PIPELINE_IDS,
  PIPELINE_REGISTRY,
  getPipelineConfig
} from "./config.js";
export type { PipelineId } from "./config.js";

export type {
  QAItem,
  ScoredResult,
  EvalRunSummary,
  FailureType,
  Severity
} from "./types.js";
