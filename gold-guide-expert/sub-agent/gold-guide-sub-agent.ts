/**
 * Gold Guide Sub-Agent
 *
 * This is the production conversation-aware wrapper around queryGoldGuide and
 * is what the Orchestrator's ask_gold_guide tool calls into.
 *
 * Responsibilities that live HERE (not in core/):
 *   - System prompt for Gold Guide policy answers
 *   - Multi-turn conversation history management
 *   - Context-budget management (see research §6.5)
 *   - Formatting the final answer for the Orchestrator
 *
 * The actual retrieval + LLM call is delegated to core/queryGoldGuide.
 */

import type { PipelineConfig, GoldGuideResult } from "../core/types.js";
import type { ModelProvider } from "../../src/agent/types.js";
import { PRODUCTION_CONFIG } from "./production-config.js";

// TODO: import { queryGoldGuide } from "../core/index.js";

export { PRODUCTION_CONFIG } from "./production-config.js";

export type GoldGuideSubAgentOptions = {
  provider: ModelProvider;

  /** Pipeline config to use in production (defaults to PRODUCTION_CONFIG) */
  config?: PipelineConfig;

  /** Maximum conversation history turns to retain */
  maxHistoryTurns?: number;
};

/**
 * Run the Gold Guide sub-agent for a single user question
 * within a conversation context.
 */
export async function askGoldGuide(
  question: string,
  options: GoldGuideSubAgentOptions
): Promise<GoldGuideResult> {
  const config = options.config ?? PRODUCTION_CONFIG;

  // TODO: Implementation includes:
  //
  // 1. Manage conversation history
  // 2. Build the question with any relevant conversation context
  // 3. Call queryGoldGuide(enrichedQuestion, config, options.provider)
  // 4. Store the turn in history
  // 5. Return the result

  throw new Error("askGoldGuide() is not yet implemented.");
}
