/**
 * Metrics
 *
 * Computes aggregate evaluation metrics from an array of ScoredResults.
 * See research-finding-summary.txt §7.5 for the full metrics list.
 */

import type { ScoredResult, EvalRunSummary } from "./types.js";

function safeAverage(total: number, count: number): number {
  return count === 0 ? 0 : total / count;
}

/**
 * Aggregate scored results into summary metrics.
 */
export function computeMetrics(
  results: ScoredResult[]
): EvalRunSummary["metrics"] {
  const totals = results.reduce(
    (acc, item) => {
      acc.correctness += item.scores.correctness;
      acc.citationPrecision += item.scores.citationPrecision;
      acc.completeness += item.scores.completeness;
      acc.totalLatencyMs += item.result.latencyMs;
      acc.totalInputTokens += item.result.usage.inputTokens;
      acc.totalOutputTokens += item.result.usage.outputTokens;
      if (item.scores.hallucinationSeverity >= 1) {
        acc.criticalHallucinations += 1;
      }
      return acc;
    },
    {
      correctness: 0,
      citationPrecision: 0,
      completeness: 0,
      criticalHallucinations: 0,
      totalLatencyMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0
    }
  );

  return {
    avgCorrectness: safeAverage(totals.correctness, results.length),
    avgCitationPrecision: safeAverage(totals.citationPrecision, results.length),
    avgCompleteness: safeAverage(totals.completeness, results.length),
    criticalHallucinations: totals.criticalHallucinations,
    totalLatencyMs: totals.totalLatencyMs,
    avgLatencyMs: safeAverage(totals.totalLatencyMs, results.length),
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens
  };
}
