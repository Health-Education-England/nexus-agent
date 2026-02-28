/**
 * Judge
 *
 * Scores a single GoldGuideResult against its QA gold-standard item.
 *
 * Can operate in two modes (see research-finding-summary.txt §8):
 *   - LLM-as-judge: automated scoring via a judge LLM
 *   - Human review: outputs a structured form for domain reviewers
 *
 * For now the skeleton assumes LLM-as-judge with the option to
 * flag items for human review based on severity.
 */

import type { GoldGuideResult } from "../core/types.js";
import type { QAItem, ScoredResult } from "./types.js";

/**
 * Score a single result against its gold-standard QA item.
 */
export async function judge(
  qaItem: QAItem,
  result: GoldGuideResult
): Promise<ScoredResult> {
  // TODO: Implementation:
  //
  // 1. Compare result.answer against qaItem.expectedAnswer
  //    (semantic similarity or LLM-as-judge prompt)
  //
  // 2. Check result.citations against qaItem.requiredCitations
  //    (citation precision / recall)
  //
  // 3. Detect hallucinations (invented rules, numbers, citations)
  //
  // 4. Classify failure type if applicable
  //
  // 5. Flag CRITICAL/HIGH severity items for human review if scores are low

  throw new Error("judge() is not yet implemented.");
}
