/**
 * Ollama Chat Provider
 *
 * Implements ModelProvider using Ollama's OpenAI-compatible
 * /v1/chat/completions endpoint, which supports native tool calling
 * for models like Qwen 3.5, Llama 3.x, Mistral, etc.
 *
 * This is the provider for chat/reasoning LLM tasks (orchestrator,
 * answer synthesis, judge). It is separate from OllamaEmbeddingProvider
 * which handles text embedding via /api/embed.
 *
 * Prerequisites:
 *   1. Ollama running locally:  ollama serve
 *   2. Model pulled:            ollama pull qwen3.5:9b
 *
 * No extra npm dependency required — uses native fetch().
 */

import type {
  ContentBlock,
  GenerateResponseOptions,
  Message,
  ModelProvider,
  ModelResponse,
  ModelUsage,
  TextBlock,
  ToolDefinition,
  ToolUseBlock,
  ToolResultBlock
} from "./types.js";
import { formatErrorCauseSuffix } from "../shared/error-format.js";

// ── Types ──

export type OllamaProviderConfig = {
  /** Ollama model tag, e.g. "qwen3.5:9b" */
  model: string;

  /** Maximum tokens to generate */
  maxTokens: number;

  /** Ollama base URL (default: http://localhost:11434) */
  baseUrl?: string;

  /**
   * Number of tokens of context the model can use.
   * Passed as num_ctx in Ollama options.
   * Defaults to 8192. Increase for long Gold Guide documents.
   */
  numCtx?: number;

  /**
   * Temperature for generation. Defaults to 0 for deterministic output
   * (important for evaluation reproducibility).
   */
  temperature?: number;

  /**
   * Maximum time (ms) to wait for the Ollama response.
   * Large local models can take minutes for model loading + inference.
   * Defaults to 600_000 (10 minutes). Set 0 for no timeout.
   */
  requestTimeoutMs?: number;

  /**
   * Disable chain-of-thought output where supported by the model.
   * Qwen 3.5 can otherwise consume completion budget in reasoning and
   * occasionally return an empty final answer string.
   */
  think?: boolean;
};

/**
 * Shape of an OpenAI-compatible chat completion request
 * as accepted by Ollama's /v1/chat/completions endpoint.
 */
type OllamaChatRequest = {
  model: string;
  messages: OllamaChatMessage[];
  tools?: OllamaTool[];
  max_tokens?: number;
  temperature?: number;
  think?: boolean;
  stream: false;
  options?: {
    num_ctx?: number;
  };
};

type OllamaChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OllamaToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type OllamaToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type OllamaChatResponse = {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content:
        | string
        | null
        | Array<
            | string
            | {
                type?: string;
                text?: string;
              }
          >;
      reasoning?: string | null;
      tool_calls?: OllamaToolCall[];
    };
    finish_reason: "stop" | "tool_calls" | "length";
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

// ── Helpers ──

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_NUM_CTX = 8192;
const DEFAULT_REQUEST_TIMEOUT_MS = 600_000; // 10 minutes — allows for model swap + slow inference

function buildUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/v1/chat/completions`;
}

/**
 * Generate a deterministic tool_call ID.
 * Ollama doesn't always return IDs in the OpenAI-compatible response,
 * so we generate stable ones when missing.
 */
function ensureToolCallId(
  toolCall: Partial<OllamaToolCall>,
  index: number
): string {
  return toolCall.id || `ollama_tc_${Date.now()}_${index}`;
}

// ── Provider ──

export class OllamaProvider implements ModelProvider {
  private readonly config: Required<
    Pick<
      OllamaProviderConfig,
      | "model"
      | "maxTokens"
      | "baseUrl"
      | "numCtx"
      | "requestTimeoutMs"
      | "think"
    >
  > &
    Pick<OllamaProviderConfig, "temperature">;

  constructor(config: OllamaProviderConfig) {
    this.config = {
      model: config.model,
      maxTokens: config.maxTokens,
      baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
      numCtx: config.numCtx ?? DEFAULT_NUM_CTX,
      requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      think: config.think ?? false,
      temperature: config.temperature
    };
  }

  async generateResponse(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt?: string,
    _options?: GenerateResponseOptions
  ): Promise<ModelResponse> {
    const ollamaMessages = this.toOllamaMessages(messages, systemPrompt);
    const ollamaTools = this.toOllamaTools(tools);

    const body: OllamaChatRequest = {
      model: this.config.model,
      messages: ollamaMessages,
      stream: false,
      max_tokens: this.config.maxTokens,
      think: this.config.think,
      ...(this.config.temperature === undefined
        ? {}
        : { temperature: this.config.temperature }),
      ...(ollamaTools.length > 0 ? { tools: ollamaTools } : {}),
      options: {
        num_ctx: this.config.numCtx
      }
    };

    const url = buildUrl(this.config.baseUrl);

    let response: Response;
    try {
      const fetchOptions: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      };
      if (this.config.requestTimeoutMs > 0) {
        fetchOptions.signal = AbortSignal.timeout(this.config.requestTimeoutMs);
      }
      response = await fetch(url, fetchOptions);
    } catch (fetchError) {
      const cause = formatErrorCauseSuffix(fetchError);
      throw new Error(`Ollama chat fetch failed for ${url}${cause}`, {
        cause: fetchError
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Ollama API error (${response.status}): ${errorText.slice(0, 500)}`
      );
    }

    const data = (await response.json()) as OllamaChatResponse;
    return this.fromOllamaResponse(data);
  }

  // ── Message translation ──

  private toOllamaMessages(
    messages: Message[],
    systemPrompt?: string
  ): OllamaChatMessage[] {
    const result: OllamaChatMessage[] = [];

    if (systemPrompt) {
      result.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        result.push({ role: msg.role, content: msg.content });
        continue;
      }

      // ContentBlock[] → translate based on role
      if (msg.role === "user") {
        // User messages can contain text or tool_result blocks
        const toolResults = msg.content.filter(
          (b): b is ToolResultBlock => b.type === "tool_result"
        );
        const textBlocks = msg.content.filter(
          (b): b is TextBlock => b.type === "text"
        );

        // Tool results become individual "tool" role messages
        for (const tr of toolResults) {
          result.push({
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: tr.content
          });
        }

        // Text blocks become a user message
        if (textBlocks.length > 0) {
          result.push({
            role: "user",
            content: textBlocks.map(b => b.text).join("\n")
          });
        }
      } else {
        // Assistant messages can contain text and tool_use blocks
        const toolUses = msg.content.filter(
          (b): b is ToolUseBlock => b.type === "tool_use"
        );
        const textBlocks = msg.content.filter(
          (b): b is TextBlock => b.type === "text"
        );
        const textContent = textBlocks.map(b => b.text).join("\n") || null;

        if (toolUses.length > 0) {
          result.push({
            role: "assistant",
            content: textContent,
            tool_calls: toolUses.map((tu, index) => ({
              id: tu.id || `ollama_tc_${index}`,
              type: "function" as const,
              function: {
                name: tu.name,
                arguments: JSON.stringify(tu.input)
              }
            }))
          });
        } else {
          result.push({
            role: "assistant",
            content: textContent ?? ""
          });
        }
      }
    }

    // Qwen models may spend completion budget on hidden reasoning and emit
    // an empty final answer. Prefix first user turn with /no_think by default.
    if (!this.config.think && this.shouldForceNoThinkPrefix()) {
      const firstUserIndex = result.findIndex(msg => msg.role === "user");
      if (firstUserIndex >= 0) {
        const firstUser = result[firstUserIndex];
        if (
          firstUser.role === "user" &&
          !firstUser.content.startsWith("/no_think")
        ) {
          result[firstUserIndex] = {
            role: "user",
            content: `/no_think\n${firstUser.content}`
          };
        }
      }
    }

    return result;
  }

  private toOllamaTools(tools: ToolDefinition[]): OllamaTool[] {
    return tools.map(tool => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: tool.input_schema.type,
          properties: tool.input_schema.properties,
          ...(tool.input_schema.required
            ? { required: tool.input_schema.required }
            : {})
        }
      }
    }));
  }

  // ── Response translation ──

  private fromOllamaResponse(data: OllamaChatResponse): ModelResponse {
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error(
        "Ollama returned an empty choices array. Check model availability."
      );
    }

    const content: ContentBlock[] = [];
    const toolCalls = choice.message.tool_calls;

    // Use assistant content only. Reasoning traces should not be used as final answers.
    const textContent = this.extractMessageText(choice.message);
    if (textContent) {
      content.push({
        type: "text",
        text: textContent
      });
    }

    // Add tool use blocks
    if (toolCalls && toolCalls.length > 0) {
      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i];
        let parsedInput: Record<string, unknown> = {};

        try {
          parsedInput = JSON.parse(tc.function.arguments) as Record<
            string,
            unknown
          >;
        } catch {
          throw new Error(
            `Failed to parse tool call arguments for '${tc.function.name}': ${tc.function.arguments}`
          );
        }

        content.push({
          type: "tool_use",
          id: ensureToolCallId(tc, i),
          name: tc.function.name,
          input: parsedInput
        });
      }
    }

    // Map finish_reason
    const stopReason = this.mapFinishReason(choice.finish_reason);

    // Map usage
    const usage: ModelUsage | undefined = data.usage
      ? {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        }
      : undefined;

    return { content, stop_reason: stopReason, usage };
  }

  private extractMessageText(message: {
    content:
      | string
      | null
      | Array<
          | string
          | {
              type?: string;
              text?: string;
            }
        >;
    reasoning?: string | null;
  }): string {
    if (typeof message.content === "string") {
      const normalized = message.content.trim();
      if (normalized.length > 0) {
        return normalized;
      }
    }

    if (Array.isArray(message.content)) {
      const parts = message.content
        .map(block => {
          if (typeof block === "string") {
            return block;
          }
          if (block && typeof block.text === "string") {
            return block.text;
          }
          return "";
        })
        .join("\n")
        .trim();

      if (parts.length > 0) {
        return parts;
      }
    }

    return "";
  }

  private shouldForceNoThinkPrefix(): boolean {
    return /^(qwen|qwq)/i.test(this.config.model.trim());
  }

  private mapFinishReason(
    reason: string | null | undefined
  ): ModelResponse["stop_reason"] {
    switch (reason) {
      case "tool_calls":
        return "tool_use";
      case "length":
        return "max_tokens";
      case "stop":
      default:
        return "end_turn";
    }
  }
}
