/**
 * Gold Guide Sub-Agent
 *
 * This is the production conversation-aware wrapper around queryGoldGuide and
 * is what the Orchestrator's ask_gold_guide tool calls into.
 *
 * Responsibilities that live HERE (not in core/):
 *   - Delegating to queryGoldGuide with the correct config + provider
 *   - Formatting the structured result for the Orchestrator
 *   - (Future) Multi-turn conversation history management
 *   - (Future) Context-budget management (see research §6.5)
 *
 * The actual retrieval + LLM call is delegated to core/queryGoldGuide.
 */

import type { PipelineConfig, GoldGuideResult } from "../core/types.js";
import type { ModelProvider } from "../../providers/types.js";
import { queryGoldGuide } from "../core/index.js";
import { PRODUCTION_CONFIG } from "./production-config.js";

export { PRODUCTION_CONFIG } from "./production-config.js";

export type GoldGuideSubAgentOptions = {
  provider: ModelProvider;

  /** Pipeline config to use (defaults to PRODUCTION_CONFIG) */
  config?: PipelineConfig;
};

/**
 * Run the Gold Guide sub-agent for a single user question.
 */
export async function askGoldGuide(
  question: string,
  options: GoldGuideSubAgentOptions
): Promise<GoldGuideResult> {
  const config = options.config ?? PRODUCTION_CONFIG;
  return queryGoldGuide(question, config, options.provider);
}

/**
 * Format a GoldGuideResult into a string suitable for returning
 * to the Orchestrator as a tool result.
 */
export function formatResultForOrchestrator(result: GoldGuideResult): string {
  const lines = [`ANSWER:`, result.answer];

  if (result.citations.length > 0) {
    lines.push(
      "",
      "CITATIONS:",
      ...result.citations.map(c => {
        const ref = c.sectionRef ?? c.canonicalId;
        return `- [${ref}] ${c.sourceText?.slice(0, 200) ?? ""}`;
      })
    );
  }

  lines.push(
    "",
    `(pipeline=${result.pipelineUsed}, tokens=${result.usage.inputTokens}+${result.usage.outputTokens}, latency=${result.latencyMs}ms)`
  );

  return lines.join("\n");
}
