/**
 * Anthropic provider — wraps @anthropic-ai/sdk with streaming support.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ModelProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderResponse,
  ProviderTool,
  ProviderUsage
} from "./types.js";

export type AnthropicProviderConfig = {
  model: string;
  maxTokens: number;
};

export class AnthropicProvider implements ModelProvider {
  private readonly client: Anthropic;
  private readonly config: AnthropicProviderConfig;

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    this.config = config;
  }

  async streamResponse(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    systemPrompt: string,
    onTextDelta: (text: string) => void
  ): Promise<ProviderResponse> {
    const stream = this.client.messages.stream({
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      system: systemPrompt,
      messages: messages as Anthropic.MessageParam[],
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema as Anthropic.Tool.InputSchema
      }))
    });

    stream.on("text", (text: string) => onTextDelta(text));

    const response = await stream.finalMessage();

    return {
      content: response.content.map(block => toProviderBlock(block)),
      stopReason: normalizeStopReason(response.stop_reason),
      usage: mapUsage(response.usage)
    };
  }
}

// ── Helpers ──

function toProviderBlock(block: Anthropic.ContentBlock): ProviderContentBlock {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>
    };
  }
  // Fallback — stringify anything unexpected so the agent loop still works.
  return { type: "text", text: JSON.stringify(block) };
}

function normalizeStopReason(
  reason: string | null | undefined
): ProviderResponse["stopReason"] {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  return "end_turn";
}

function mapUsage(
  usage: Anthropic.Usage | undefined
): ProviderUsage | undefined {
  if (!usage) return undefined;
  const u = usage as unknown as Record<string, unknown>;
  const inputTokens = typeof u.input_tokens === "number" ? u.input_tokens : 0;
  const outputTokens =
    typeof u.output_tokens === "number" ? u.output_tokens : 0;
  const result: ProviderUsage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens
  };
  if (typeof u.cache_creation_input_tokens === "number") {
    result.cacheCreationInputTokens = u.cache_creation_input_tokens;
  }
  if (typeof u.cache_read_input_tokens === "number") {
    result.cacheReadInputTokens = u.cache_read_input_tokens;
  }
  return result;
}
