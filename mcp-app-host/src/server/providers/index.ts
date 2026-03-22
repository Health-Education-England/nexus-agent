/**
 * Provider barrel — exports types + factory.
 *
 * Usage in agent.ts:
 *   import { createProvider, type ModelProvider } from "./providers/index.js";
 *   const provider = createProvider();
 */

export type {
  ModelProvider,
  ProviderContentBlock,
  ProviderMessage,
  ProviderResponse,
  ProviderTool,
  ProviderToolResultBlock,
  ProviderToolUseBlock,
  ProviderUsage,
  ProviderName
} from "./types.js";

export { AnthropicProvider } from "./anthropic.js";
export type { AnthropicProviderConfig } from "./anthropic.js";

export { BedrockProvider } from "./bedrock.js";
export type { BedrockProviderConfig } from "./bedrock.js";

import { AnthropicProvider } from "./anthropic.js";
import { BedrockProvider } from "./bedrock.js";
import type { ModelProvider, ProviderName } from "./types.js";

/**
 * Create a provider from environment variables.
 *
 * Env vars:
 *   AI_PROVIDER        — "anthropic" (default) | "bedrock"
 *   ANTHROPIC_MODEL    — model id for Anthropic (default: claude-sonnet-4-20250514)
 *   BEDROCK_MODEL      — model id for Bedrock
 *   AWS_REGION         — AWS region for Bedrock
 */
export function createProvider(maxTokens: number = 4096): {
  provider: ModelProvider;
  providerName: ProviderName;
  model: string;
} {
  const providerName = (process.env.AI_PROVIDER ?? "anthropic") as ProviderName;

  switch (providerName) {
    case "anthropic": {
      const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
      return {
        provider: new AnthropicProvider({ model, maxTokens }),
        providerName,
        model
      };
    }
    case "bedrock": {
      const model = process.env.BEDROCK_MODEL;
      if (!model) {
        throw new Error("BEDROCK_MODEL environment variable is required");
      }
      const region = process.env.AWS_REGION;
      if (!region) {
        throw new Error("AWS_REGION environment variable is required");
      }
      return {
        provider: new BedrockProvider({ model, maxTokens, region }),
        providerName,
        model
      };
    }
    default:
      throw new Error(
        `Unknown AI_PROVIDER "${providerName}". Supported: anthropic, bedrock`
      );
  }
}
