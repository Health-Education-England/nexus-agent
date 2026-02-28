/**
 * Evaluation Runner
 *
 * Reads a QA dataset, runs each question through queryGoldGuide
 * with the specified PipelineConfig, collects results, and hands
 * them to the judge for scoring.
 *
 * Usage (future):
 *   npx tsx gold-guide-expert/evaluation/runner.ts --dataset development --pipeline cag
 */

import type { PipelineConfig } from "../core/types.js";
import type { QAItem, EvalRunSummary } from "./types.js";
import type { ModelProvider } from "../../src/agent/types.js";

// TODO: import { queryGoldGuide } from "../core/index.js";
// TODO: import { judge } from "./judge.js";
// TODO: import { loadDataset } from "./config.js";

/**
 * Run a full evaluation pass over a QA dataset.
 */
export async function runEvaluation(
  dataset: QAItem[],
  config: PipelineConfig,
  provider: ModelProvider
): Promise<EvalRunSummary> {
  // TODO: Implementation:
  //
  // 1. Iterate over QA items
  // 2. For each item: call queryGoldGuide(item.question, config, provider)
  // 3. Score each result via judge
  // 4. Aggregate metrics into EvalRunSummary
  // 5. Log / persist results

  throw new Error("runEvaluation is not yet implemented.");
}
