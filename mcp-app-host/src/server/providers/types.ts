/**
 * Provider-agnostic types for the plug-and-play AI model architecture.
 *
 * Every provider (Anthropic, Bedrock, Ollama, …) implements the
 * `ModelProvider` interface. The agent loop works exclusively with these
 * types and never imports a vendor SDK directly.
 */

// ── Message types ──

export type ProviderMessage = {
  role: "user" | "assistant";
  content: string | ProviderContentBlock[];
};

export type ProviderContentBlock =
  | ProviderTextBlock
  | ProviderToolUseBlock
  | ProviderToolResultBlock;

export type ProviderTextBlock = {
  type: "text";
  text: string;
};

export type ProviderToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ProviderToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};

// ── Tool definition ──

export type ProviderTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

// ── Response types ──

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
};

export type ProviderResponse = {
  content: ProviderContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  usage?: ProviderUsage;
};

// ── Provider interface ──

/**
 * Streaming-capable provider contract.
 *
 * `streamResponse` sends text deltas to the caller via `onTextDelta` as
 * they arrive from the model, then resolves with the full response once
 * the model turn is complete.
 */
export type ModelProvider = {
  streamResponse(
    messages: ProviderMessage[],
    tools: ProviderTool[],
    systemPrompt: string,
    onTextDelta: (text: string) => void
  ): Promise<ProviderResponse>;
};

// ── Provider configuration ──

export type ProviderName = "anthropic" | "bedrock";
