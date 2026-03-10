import Anthropic from "@anthropic-ai/sdk";
import type { ModelProvider } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import type { PromptCacheTTL } from "./anthropic.js";
import { BedrockProvider } from "./bedrock.js";
import { OllamaProvider } from "./ollama.js";

export type ProviderName =
  | "anthropic"
  | "openai"
  | "gemini"
  | "bedrock"
  | "ollama";

export type ProviderFactoryResult = {
  provider: ModelProvider;
  providerName: ProviderName;
  model: string;
};

function normalizePromptCacheTTL(
  value: string | undefined
): PromptCacheTTL | undefined {
  if (!value || value.trim() === "") {
    return undefined;
  }

  const ttl = value.trim().toLowerCase();
  if (ttl === "5m" || ttl === "1h") {
    return ttl;
  }

  throw new Error(
    `Unsupported ANTHROPIC_PROMPT_CACHE_TTL '${value}'. Supported values: 5m, 1h`
  );
}

function normalizeProviderName(value: string | undefined): ProviderName {
  if (!value || value.trim() === "") {
    throw new Error(
      "AI_PROVIDER environment variable is required. Supported values: anthropic, openai, gemini, bedrock"
    );
  }

  const provider = value.trim().toLowerCase();

  if (
    provider === "anthropic" ||
    provider === "openai" ||
    provider === "gemini" ||
    provider === "bedrock" ||
    provider === "ollama"
  ) {
    return provider;
  }

  throw new Error(
    `Unsupported AI_PROVIDER '${value}'. Supported values: anthropic, bedrock, ollama (openai, gemini planned)`
  );
}

/**
 * Create an Ollama provider for a specific model.
 * Used by the eval runner to create answer/judge providers when
 * provider="ollama" is set in a pipeline config.
 */
export function createOllamaProvider(
  model: string,
  maxTokens: number,
  options?: { baseUrl?: string; numCtx?: number }
): ModelProvider {
  return new OllamaProvider({
    model,
    maxTokens,
    baseUrl: options?.baseUrl ?? process.env.OLLAMA_BASE_URL,
    numCtx:
      options?.numCtx ??
      (process.env.OLLAMA_NUM_CTX
        ? Number.parseInt(process.env.OLLAMA_NUM_CTX, 10)
        : undefined),
    temperature: 0
  });
}

/**
 * Create an Anthropic provider for a specific model.
 * Reuses the same API key from env but allows a different model ID.
 */
export function createAnthropicProvider(
  model: string,
  maxTokens: number
): ModelProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const promptCacheTTL = normalizePromptCacheTTL(
    process.env.ANTHROPIC_PROMPT_CACHE_TTL
  );

  const client = new Anthropic({ apiKey });
  return new AnthropicProvider(client, { model, maxTokens, promptCacheTTL });
}

export function createProviderFromEnv(
  maxTokens: number
): ProviderFactoryResult {
  const providerName = normalizeProviderName(process.env.AI_PROVIDER);

  switch (providerName) {
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      const model = process.env.ANTHROPIC_MODEL;

      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY environment variable is required");
      }
      if (!model) {
        throw new Error(
          "ANTHROPIC_MODEL environment variable is required when AI_PROVIDER=anthropic"
        );
      }

      const promptCacheTTL = normalizePromptCacheTTL(
        process.env.ANTHROPIC_PROMPT_CACHE_TTL
      );

      const client = new Anthropic({ apiKey });
      const provider = new AnthropicProvider(client, {
        model,
        maxTokens,
        promptCacheTTL
      });
      return { provider, providerName, model };
    }

    case "ollama": {
      const model = process.env.OLLAMA_MODEL;
      if (!model) {
        throw new Error(
          "OLLAMA_MODEL environment variable is required when AI_PROVIDER=ollama\n" +
            "Example: qwen3.5:9b"
        );
      }
      const baseUrl = process.env.OLLAMA_BASE_URL;
      const numCtx = process.env.OLLAMA_NUM_CTX
        ? Number.parseInt(process.env.OLLAMA_NUM_CTX, 10)
        : undefined;

      const provider = new OllamaProvider({
        model,
        maxTokens,
        baseUrl,
        numCtx,
        temperature: 0
      });
      return { provider, providerName, model };
    }

    case "openai":
      throw new Error(
        "AI_PROVIDER=openai is not implemented yet. Add an OpenAI adapter under providers/"
      );

    case "gemini":
      throw new Error("AI_PROVIDER=gemini is not implemented yet.");

    case "bedrock": {
      const model = process.env.BEDROCK_MODEL;
      const region = process.env.AWS_REGION;

      if (!model) {
        throw new Error(
          "BEDROCK_MODEL environment variable is required when AI_PROVIDER=bedrock\n" +
            "Example: anthropic.claude-3-5-sonnet-20241022-v2:0"
        );
      }
      if (!region) {
        throw new Error(
          "AWS_REGION environment variable is required when AI_PROVIDER=bedrock"
        );
      }

      const provider = new BedrockProvider({ model, maxTokens, region });
      return { provider, providerName, model };
    }
  }
}
