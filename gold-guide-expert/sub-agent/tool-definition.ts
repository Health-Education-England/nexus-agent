/**
 * Gold Guide Tool Definition
 *
 * The ToolDefinition that the Orchestrator agent uses to invoke the
 * Gold Guide sub-agent. This is the thin bridge between the
 * Orchestrator's tool-calling loop and the sub-agent.
 *
 * This replaces the placeholder at src/tools/gold-guide-expert.tool.ts
 * — that file now re-exports from here.
 */

import type { ToolDefinition, ModelProvider } from "../../providers/types.js";
import type { PipelineConfig } from "../core/types.js";
import {
  askGoldGuide,
  formatResultForOrchestrator
} from "./gold-guide-sub-agent.js";

export type GoldGuideToolOptions = {
  /** Provider for the sub-agent LLM call (can differ from the orchestrator's provider). */
  provider: ModelProvider;

  /** Override pipeline config (defaults to PRODUCTION_CONFIG). */
  config?: PipelineConfig;
};

export function createGoldGuideExpertTool(
  options: GoldGuideToolOptions
): ToolDefinition {
  return {
    name: "ask_gold_guide",
    description: `Use this tool to answer any question about Postgraduate Foundation and
Specialty Training in the UK. This applies to all doctors in core and specialty training (including individuals from
non-medical careers training in public health), and to all foundation doctors across the UK.  
The tool returns an accurate, cited answer drawn from the official Gold Guide (10th Edition) document.
Only use this tool for policy-related questions. For Less than full-time (LTFT) calculations, use the ltft_calculator tool.`,
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The policy question to answer, in natural language."
        }
      },
      required: ["question"]
    },
    execute: async (input: Record<string, unknown>): Promise<string> => {
      const question = input.question as string;
      const result = await askGoldGuide(question, {
        provider: options.provider,
        config: options.config
      });
      return formatResultForOrchestrator(result);
    }
  };
}
