// NOTE: Still WIP, not tested this code yet until we get Bedrock set up (using Anthropic provider via my own API key for now).

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type Message as BedrockMessage,
  type ConversationRole,
  type ToolConfiguration
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@aws-sdk/types";
import type {
  ContentBlock,
  GenerateResponseOptions,
  Message,
  ModelUsage,
  ModelProvider,
  ModelResponse,
  ProviderToolChoice,
  ToolDefinition
} from "./types.js";
import { normalizeStopReason } from "../shared/normalize-stop-reason.js";

export type BedrockToolChoice = ProviderToolChoice;

export type BedrockProviderConfig = {
  model: string;
  maxTokens: number;
  region: string;
  toolChoice?: BedrockToolChoice;
};

export class BedrockProvider implements ModelProvider {
  private readonly client: BedrockRuntimeClient;
  private readonly config: BedrockProviderConfig;

  constructor(config: BedrockProviderConfig) {
    this.config = config;
    this.client = new BedrockRuntimeClient({
      region: config.region
    });
  }

  async generateResponse(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt?: string,
    options?: GenerateResponseOptions
  ): Promise<ModelResponse> {
    if (options?.promptCaching) {
      throw new Error(
        "Prompt caching controls for Bedrock not implemented yet (see https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html for more info)."
      );
    }

    const bedrockMessages = messages.map(m => this.toBedrockMessage(m));
    const resolvedToolChoice = options?.toolChoice ?? this.config.toolChoice;

    const system: { text: string }[] | undefined = systemPrompt
      ? [{ text: systemPrompt }]
      : undefined;

    const bedrockTools: NonNullable<ToolConfiguration["tools"]> = tools.map(
      t => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: {
            json: t.input_schema as unknown as DocumentType
          }
        }
      })
    );

    const mappedToolChoice = this.mapToolChoice(resolvedToolChoice, tools);

    const toolConfig: ToolConfiguration | undefined =
      bedrockTools.length > 0
        ? {
            tools: bedrockTools,
            ...(mappedToolChoice ? { toolChoice: mappedToolChoice } : {})
          }
        : undefined;

    const command = new ConverseCommand({
      modelId: this.config.model,
      messages: bedrockMessages,
      system,
      toolConfig,
      inferenceConfig: {
        maxTokens: this.config.maxTokens
      }
    });

    const response = await this.client.send(command);
    return this.fromBedrockResponse(response);
  }

  private toBedrockMessage(message: Message): BedrockMessage {
    if (typeof message.content === "string") {
      return {
        role: message.role,
        content: [{ text: message.content }]
      };
    }

    const blocks = message.content.map(block => {
      switch (block.type) {
        case "text":
          return { text: block.text };
        case "tool_use":
          return {
            toolUse: {
              toolUseId: block.id,
              name: block.name,
              input: block.input
            }
          };
        case "tool_result": {
          const tr = block;
          return {
            toolResult: {
              toolUseId: tr.tool_use_id,
              content: [{ text: tr.content }],
              status: tr.is_error ? ("error" as const) : ("success" as const)
            }
          };
        }
        default:
          return { text: JSON.stringify(block) };
      }
    });

    return {
      role: message.role as ConversationRole,
      content: blocks as BedrockMessage["content"]
    };
  }

  private fromBedrockResponse(response: ConverseCommandOutput): ModelResponse {
    const outputBlocks = response.output?.message?.content ?? [];
    const content: ContentBlock[] = [];

    for (const block of outputBlocks) {
      if (block.text !== undefined) {
        content.push({ type: "text", text: block.text });
      } else if (block.toolUse) {
        content.push({
          type: "tool_use",
          id: block.toolUse.toolUseId ?? "",
          name: block.toolUse.name ?? "",
          input: (block.toolUse.input as Record<string, unknown>) ?? {}
        });
      }
    }

    const usage = this.mapUsage(
      response.usage as Record<string, unknown> | undefined
    );
    const latencyMs =
      response.metrics && typeof response.metrics.latencyMs === "number"
        ? response.metrics.latencyMs
        : undefined;

    return {
      content,
      stop_reason: normalizeStopReason(response.stopReason),
      usage,
      providerMetrics: {
        latencyMs
      }
    };
  }

  private mapUsage(
    usage: Record<string, unknown> | undefined
  ): ModelUsage | undefined {
    if (!usage) {
      return undefined;
    }

    const inputTokens =
      typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
    const outputTokens =
      typeof usage.outputTokens === "number" ? usage.outputTokens : 0;

    const mappedUsage: ModelUsage = {
      inputTokens,
      outputTokens
    };

    if (typeof usage.totalTokens === "number") {
      mappedUsage.totalTokens = usage.totalTokens;
    } else {
      mappedUsage.totalTokens = inputTokens + outputTokens;
    }

    if (typeof usage.cacheReadInputTokens === "number") {
      mappedUsage.cacheReadInputTokens = usage.cacheReadInputTokens;
    }

    if (typeof usage.cacheWriteInputTokens === "number") {
      mappedUsage.cacheCreationInputTokens = usage.cacheWriteInputTokens;
    }

    return mappedUsage;
  }

  private mapToolChoice(
    choice: BedrockToolChoice | undefined,
    tools: ToolDefinition[]
  ): ToolConfiguration["toolChoice"] | undefined {
    if (!choice) return undefined;
    if (tools.length === 0) {
      throw new Error("toolChoice is set but no tools were provided");
    }
    if (choice === "auto") return { auto: {} };
    if (choice === "any") return { any: {} };

    const toolName = choice.tool;
    if (!tools.some(t => t.name === toolName)) {
      throw new Error(
        `toolChoice requested tool '${toolName}', but it is not in the provided tools list`
      );
    }
    return { tool: { name: toolName } };
  }
}
