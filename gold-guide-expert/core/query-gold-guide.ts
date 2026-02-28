/**
 * queryGoldGuide — the single shared entry point.
 *
 * Both the evaluation harness and the production sub-agent call this
 * function. It is intentionally STATELESS: no conversation history,
 * no agent plumbing — just question in, structured result out.
 *
 * Internally it:
 *   1. Selects the retrieval pipeline based on config.pipeline
 *   2. Retrieves relevant chunks (or the full document for CAG)
 *   3. Calls the LLM with the retrieved context + question
 *   4. Parses the response into a GoldGuideResult
 */

import type { PipelineConfig, GoldGuideResult } from "./types.js";
import type { ModelProvider } from "../../src/agent/types.js";
import { PIPELINE_FACTORIES } from "./retrieval/index.js";

export async function queryGoldGuide(
  question: string,
  config: PipelineConfig,
  provider: ModelProvider
): Promise<GoldGuideResult> {
  const pipelineFactory = PIPELINE_FACTORIES[config.pipeline];
  if (!pipelineFactory) {
    throw new Error(`Unsupported pipeline type: ${config.pipeline}`);
  }
  const pipeline = pipelineFactory();

  // TODO: Implementation phases:
  //
  // 1. Select retrieval pipeline based on config.pipeline (DONE)
  //
  // 2. Call pipeline.retrieve(question, config) → RetrievedChunk[]
  //
  // 3. Build LLM prompt from retrieved chunks + question
  //
  // 4. Call LLM via the appropriate provider
  //
  // 5. Parse response into GoldGuideResult (answer, citations, other metadata e.g.latency)

  throw new Error(
    "queryGoldGuide is not yet implemented — see implementation phases above."
  );
}
