/**
 * queryGoldGuide — the single shared entry point.
 *
 * Both the evaluation harness and the production sub-agent call this
 * function. It is intentionally STATELESS: no conversation history,
 * no agent plumbing — just question in, structured result out.
 *
 * Internally it:
 *   1. Selects the retrieval pipeline based on config.pipeline
 *   2. Retrieves relevant chunks (or the full document for CAG)
 *   3. Calls the LLM with the retrieved context + question
 *   4. Parses the response into a GoldGuideResult
 */

import type {
  PipelineConfig,
  GoldGuideResult,
  Citation,
  RetrievedChunk
} from "./types.js";
import type { Message, ModelProvider } from "../../src/agent/types.js";
import { PIPELINE_FACTORIES } from "./retrieval/index.js";

function normalizeRef(value: string): string {
  const normalized = value
    .toLowerCase()
    .replaceAll(/[()[\],;:]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replaceAll(/^(paragraph|para|section)\s+/g, "");

  const compactRoman = /^(\d+(?:\.\d+)*)([ivx]+)$/i.exec(normalized);
  if (compactRoman) {
    return `${compactRoman[1]} ${compactRoman[2]}`;
  }

  return normalized;
}

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      chunk =>
        `[${chunk.canonicalId}] ${chunk.content.replaceAll(/\s+/g, " ").trim()}`
    )
    .join("\n");
}

function extractAnswerText(
  responseContent: Array<{ type: string } & Record<string, unknown>>
): string {
  const textParts: string[] = [];

  for (const block of responseContent) {
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    }
  }

  return textParts.join("\n").trim();
}

function extractCitations(
  answer: string,
  chunks: RetrievedChunk[]
): Citation[] {
  const citationPattern =
    /(?:\b(?:paragraph|para|section)\s+)?(\d+(?:\.\d+)*(?:\s*[ivx]+)?)/gi;

  const chunkIndex = new Map<string, RetrievedChunk>();
  for (const chunk of chunks) {
    chunkIndex.set(normalizeRef(chunk.canonicalId), chunk);
  }

  const citations = new Map<string, Citation>();
  let match = citationPattern.exec(answer);
  while (match) {
    const rawMatch = match[1] ?? "";
    const normalized = normalizeRef(rawMatch);
    const supportingChunk = chunkIndex.get(normalized);

    if (supportingChunk) {
      citations.set(normalized, {
        canonicalId: supportingChunk.canonicalId,
        sectionRef: supportingChunk.canonicalId,
        sourceText: supportingChunk.content
      });
    }

    match = citationPattern.exec(answer);
  }

  if (citations.size === 0) {
    for (const chunk of chunks.slice(0, 3)) {
      const normalized = normalizeRef(chunk.canonicalId);
      citations.set(normalized, {
        canonicalId: chunk.canonicalId,
        sectionRef: chunk.canonicalId,
        sourceText: chunk.content
      });
    }
  }

  return [...citations.values()];
}

export async function queryGoldGuide(
  question: string,
  config: PipelineConfig,
  provider: ModelProvider
): Promise<GoldGuideResult> {
  const startTime = Date.now();

  const pipelineFactory = PIPELINE_FACTORIES[config.pipeline];
  if (!pipelineFactory) {
    throw new Error(`Unsupported pipeline type: ${config.pipeline}`);
  }

  const pipeline = pipelineFactory();
  const retrievedChunks = await pipeline.retrieve(question, config);
  const contextText = buildContext(retrievedChunks);

  const systemPrompt =
    "You are the Gold Guide 10th edition policy assistant. Answer only from provided context. " +
    "When answering, include paragraph citations using the canonical IDs exactly (e.g. 1.15 i, 4.71). " +
    "If the context is insufficient, say you cannot answer from the provided context. " +
    "If the context contains a direct rule, threshold, or condition that answers the question, state that answer explicitly in the first sentence and do not hedge.";

  const promptHeader = [
    "QUESTION:",
    question,
    "",
    "CANONICAL CONTEXT:",
    ""
  ].join("\n");

  const promptFooter = [
    "RESPONSE FORMAT:",
    "- Start with a direct answer sentence.",
    "- If a numeric threshold/period exists in context, state it explicitly in that first sentence.",
    "- Do not say 'cannot find' or 'insufficient context' when cited context directly answers the question.",
    "- Answer concisely and clearly.",
    "- Include explicit citation IDs in the answer."
  ].join("\n");

  const enablePromptCaching =
    config.provider === "anthropic" && config.pipeline === "cag";

  const userMessage: Message = enablePromptCaching
    ? {
        role: "user",
        content: [
          {
            type: "text",
            text: promptHeader
          },
          {
            type: "text",
            text: contextText,
            shouldSetExplicitCache: true
          },
          {
            type: "text",
            text: promptFooter
          }
        ]
      }
    : {
        role: "user",
        content: `${promptHeader}${contextText}\n\n${promptFooter}`
      };

  const response = await provider.generateResponse(
    [userMessage],
    [],
    systemPrompt,
    {
      promptCaching: enablePromptCaching
    }
  );

  const answer = extractAnswerText(
    response.content as Array<{ type: string } & Record<string, unknown>>
  );
  if (!answer) {
    throw new Error("Model returned an empty answer for Gold Guide query.");
  }

  const citations = extractCitations(answer, retrievedChunks);

  return {
    answer,
    citations,
    retrievedChunks,
    pipelineUsed: config.pipeline,
    usage: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0
    },
    latencyMs: response.providerMetrics?.latencyMs ?? Date.now() - startTime
  };
}
