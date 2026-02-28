/**
 * Metrics
 *
 * Computes aggregate evaluation metrics from an array of ScoredResults.
 * See research-finding-summary.txt §7.5 for the full metrics list.
 */

import type { ScoredResult, EvalRunSummary } from "./types.js";

/**
 * Aggregate scored results into summary metrics.
 */
export function computeMetrics(
  results: ScoredResult[]
): EvalRunSummary["metrics"] {
  // TODO: Implementation:
  //
  // - avgCorrectness
  // - avgCitationPrecision
  // - avgCompleteness
  // - criticalHallucinations (count of severity >= critical)
  // - totalLatencyMs / avgLatencyMs
  // - totalInputTokens / totalOutputTokens

  throw new Error("computeMetrics() is not yet implemented.");
}
