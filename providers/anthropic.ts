import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  GenerateResponseOptions,
  Message,
  ModelUsage,
  ModelProvider,
  ModelResponse,
  ToolDefinition
} from "./types.js";
import { normalizeStopReason } from "../shared/normalize-stop-reason.js";

/**
 * Anthropic-specific prompt-cache TTL.
 * Exported so that provider-factory and the eval runner can
 * reference it when constructing an AnthropicProvider.
 */
export type PromptCacheTTL = "5m" | "1h";

export type AnthropicProviderConfig = {
  model: string;
  maxTokens: number;
  promptCacheTTL?: PromptCacheTTL;
};

type AnthropicCacheControl = {
  type: "ephemeral";
  ttl?: PromptCacheTTL;
};

export class AnthropicProvider implements ModelProvider {
  private readonly client: Anthropic;
  private readonly config: AnthropicProviderConfig;

  constructor(client: Anthropic, config: AnthropicProviderConfig) {
    this.client = client;
    this.config = config;
  }

  async generateResponse(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt?: string,
    options?: GenerateResponseOptions
  ): Promise<ModelResponse> {
    const promptCachingEnabled = options?.promptCaching === true;

    const cacheControl: AnthropicCacheControl =
      this.config.promptCacheTTL === "1h"
        ? { type: "ephemeral", ttl: "1h" }
        : { type: "ephemeral" };

    const messagesForRequest = promptCachingEnabled
      ? this.applyAnthropicCacheControl(messages, cacheControl)
      : messages;

    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      messages: messagesForRequest as Anthropic.MessageParam[],
      system: systemPrompt,
      tools: tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema as Anthropic.Tool.InputSchema
      })),
      ...(promptCachingEnabled ? { cache_control: cacheControl } : {})
    };

    const onTextDelta = options?.onTextDelta;

    if (onTextDelta) {
      // Streaming path — streams tokens to the caller as they arrive.
      // Works with or without prompt caching (cache_control is embedded in
      // content blocks by applyAnthropicCacheControl above).
      const stream = this.client.messages.stream(
        body as Anthropic.MessageCreateParamsNonStreaming
      );
      stream.on("text", (text: string) => onTextDelta(text));
      const finalMsg = await stream.finalMessage();
      const usage = this.mapUsage(
        finalMsg.usage as unknown as Record<string, unknown>
      );
      return {
        content: finalMsg.content as ContentBlock[],
        stop_reason: normalizeStopReason(finalMsg.stop_reason),
        usage
      };
    }

    const response = promptCachingEnabled
      ? await this.client.beta.promptCaching.messages.create(
          body as Anthropic.Beta.PromptCaching.MessageCreateParamsNonStreaming
        )
      : await this.client.messages.create(body);

    const usage = this.mapUsage(
      response.usage as unknown as Record<string, unknown>
    );

    return {
      content: response.content as ContentBlock[],
      stop_reason: normalizeStopReason(response.stop_reason),
      usage
    };
  }

  private mapUsage(usage: Record<string, unknown>): ModelUsage {
    const inputTokens =
      typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
    const outputTokens =
      typeof usage.output_tokens === "number" ? usage.output_tokens : 0;

    const mappedUsage: ModelUsage = {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    };

    if (typeof usage.cache_creation_input_tokens === "number") {
      mappedUsage.cacheCreationInputTokens = usage.cache_creation_input_tokens;
    }

    if (typeof usage.cache_read_input_tokens === "number") {
      mappedUsage.cacheReadInputTokens = usage.cache_read_input_tokens;
    }

    return mappedUsage;
  }

  /**
   * Translate provider-agnostic `shouldSetExplicitCache` markers into
   * Anthropic's wire-format `cache_control` blocks.
   */
  private applyAnthropicCacheControl(
    messages: Message[],
    cacheControl: AnthropicCacheControl
  ): Message[] {
    return messages.map(message => {
      if (typeof message.content === "string") {
        return message;
      }

      return {
        ...message,
        content: message.content.map(block => {
          if (block.type !== "text" || !block.shouldSetExplicitCache) {
            return block;
          }

          // Build an Anthropic-specific content block with cache_control.
          // The type assertion is intentional: this block is destined
          // for the Anthropic wire format, not our internal Message type.
          return {
            type: "text" as const,
            text: block.text,
            cache_control: cacheControl
          } as unknown as ContentBlock;
        })
      };
    });
  }
}
