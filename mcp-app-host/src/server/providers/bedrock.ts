/**
 * AWS Bedrock provider — uses ConverseStream for streaming text deltas.
 *
 * Converts between the provider-agnostic types and Bedrock's wire format,
 * reusing the conversion patterns from the root project's bedrock provider.
 */

import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type ConversationRole,
  type ContentBlock as BedrockContentBlock,
  type ToolConfiguration
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@aws-sdk/types";
import type {
  ModelProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderResponse,
  ProviderTool,
  ProviderUsage
} from "./types.js";

export type BedrockProviderConfig = {
  model: string;
  maxTokens: number;
  region: string;
};

export class BedrockProvider implements ModelProvider {
  private readonly client: BedrockRuntimeClient;
  private readonly config: BedrockProviderConfig;

  constructor(config: BedrockProviderConfig) {
    this.config = config;
    this.client = new BedrockRuntimeClient({ region: config.region });
  }

  async streamResponse(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    systemPrompt: string,
    onTextDelta: (text: string) => void
  ): Promise<ProviderResponse> {
    const bedrockMessages = messages.map(m => toBedrockMessage(m));

    const bedrockTools: NonNullable<ToolConfiguration["tools"]> = tools.map(
      t => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.input_schema as unknown as DocumentType }
        }
      })
    );

    const toolConfig: ToolConfiguration | undefined =
      bedrockTools.length > 0 ? { tools: bedrockTools } : undefined;

    const command = new ConverseStreamCommand({
      modelId: this.config.model,
      messages: bedrockMessages,
      system: [{ text: systemPrompt }],
      toolConfig,
      inferenceConfig: { maxTokens: this.config.maxTokens }
    });

    const response = await this.client.send(command);

    // Accumulate the streamed events into a full response.
    const contentBlocks: ProviderContentBlock[] = [];
    let stopReason: ProviderResponse["stopReason"] = "end_turn";
    let usage: ProviderUsage | undefined;

    // Track the tool_use block currently being assembled.
    let pendingToolUse: {
      id: string;
      name: string;
      inputJson: string;
    } | null = null;

    if (response.stream) {
      for await (const event of response.stream) {
        if (event.contentBlockStart) {
          const start = event.contentBlockStart.start;
          if (start?.toolUse) {
            pendingToolUse = {
              id: start.toolUse.toolUseId ?? "",
              name: start.toolUse.name ?? "",
              inputJson: ""
            };
          }
        }

        if (event.contentBlockDelta) {
          const delta = event.contentBlockDelta.delta;
          if (delta?.text) {
            onTextDelta(delta.text);
            // If the last content block is text, append; otherwise push new.
            const last = contentBlocks.at(-1);
            if (last?.type === "text") {
              (last as { type: "text"; text: string }).text += delta.text;
            } else {
              contentBlocks.push({ type: "text", text: delta.text });
            }
          }
          if (delta?.toolUse?.input) {
            if (pendingToolUse) {
              pendingToolUse.inputJson += delta.toolUse.input;
            }
          }
        }

        if (event.contentBlockStop !== undefined) {
          if (pendingToolUse) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(pendingToolUse.inputJson || "{}");
            } catch {
              // If parsing fails, pass the raw string for debugging.
              input = { _raw: pendingToolUse.inputJson };
            }
            contentBlocks.push({
              type: "tool_use",
              id: pendingToolUse.id,
              name: pendingToolUse.name,
              input
            });
            pendingToolUse = null;
          }
        }

        if (event.messageStop) {
          stopReason = normalizeStopReason(event.messageStop.stopReason);
        }

        if (event.metadata) {
          const rawUsage = event.metadata.usage as
            | Record<string, unknown>
            | undefined;
          usage = mapUsage(rawUsage);
        }
      }
    }

    return { content: contentBlocks, stopReason, usage };
  }
}

// ── Conversion helpers ──

function toBedrockMessage(message: ProviderMessage): BedrockMessage {
  if (typeof message.content === "string") {
    return {
      role: message.role as ConversationRole,
      content: [{ text: message.content }]
    };
  }

  const blocks: BedrockContentBlock[] = message.content.map(block => {
    switch (block.type) {
      case "text":
        return { text: block.text } as BedrockContentBlock;
      case "tool_use":
        return {
          toolUse: {
            toolUseId: block.id,
            name: block.name,
            input: block.input as unknown as DocumentType
          }
        } as BedrockContentBlock;
      case "tool_result":
        return {
          toolResult: {
            toolUseId: block.tool_use_id,
            content: [{ text: block.content }],
            status: block.is_error ? "error" : "success"
          }
        } as BedrockContentBlock;
      default:
        return { text: JSON.stringify(block) } as BedrockContentBlock;
    }
  });

  return {
    role: message.role as ConversationRole,
    content: blocks
  };
}

function normalizeStopReason(
  reason: string | undefined
): ProviderResponse["stopReason"] {
  if (reason === "tool_use") return "tool_use";
  if (reason === "max_tokens") return "max_tokens";
  return "end_turn";
}

function mapUsage(
  usage: Record<string, unknown> | undefined
): ProviderUsage | undefined {
  if (!usage) return undefined;
  const inputTokens =
    typeof usage.inputTokens === "number" ? usage.inputTokens : 0;
  const outputTokens =
    typeof usage.outputTokens === "number" ? usage.outputTokens : 0;
  const result: ProviderUsage = {
    inputTokens,
    outputTokens,
    totalTokens:
      typeof usage.totalTokens === "number"
        ? usage.totalTokens
        : inputTokens + outputTokens
  };
  if (typeof usage.cacheReadInputTokens === "number") {
    result.cacheReadInputTokens = usage.cacheReadInputTokens;
  }
  if (typeof usage.cacheWriteInputTokens === "number") {
    result.cacheCreationInputTokens = usage.cacheWriteInputTokens;
  }
  return result;
}
