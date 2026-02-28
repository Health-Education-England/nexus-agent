// ── Shared types for provider-agnostic messaging & tool calling ──

export type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export type TextBlock = {
  type: "text";
  text: string;
}

export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ModelResponse = {
  content: ContentBlock[];
  stop_reason: "tool_use" | "end_turn" | "max_tokens";
}

export type ToolInputSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: ToolInputSchema;
  execute: (input: Record<string, unknown>) => Promise<string> | string;
}

export type ProviderToolChoice = "auto" | "any" | { tool: string };

export type GenerateResponseOptions = {
  toolChoice?: ProviderToolChoice;
}

export type ModelProvider = {
  generateResponse(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt?: string,
    options?: GenerateResponseOptions
  ): Promise<ModelResponse>;
}
