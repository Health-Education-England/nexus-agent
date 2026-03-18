/**
 * queryGoldGuide — single entry point for the Gold Guide MCP server.
 *
 * Simplified from gold-guide-expert/core/query-gold-guide.ts:
 * - CAG pipeline hardcoded (no PipelineConfig / PIPELINE_FACTORIES)
 * - Anthropic SDK called directly (no ModelProvider abstraction)
 * - Prompt caching preserved: cache_control on the context block +
 *   client.beta.promptCaching.messages.create()
 *
 * Stateless: question in → GoldGuideResult out, no conversation history.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { GoldGuideResult, Citation, RetrievedChunk } from "./types.js";
import { retrieveAll } from "./cag-pipeline.js";

// ── Helpers ──────────────────────────────────────────────────────────

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

function extractAnswerText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map(block => block.text)
    .join("\n")
    .trim();
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

// ── Main query function ───────────────────────────────────────────────

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;

const SYSTEM_PROMPT =
  "You are the Gold Guide 10th edition policy assistant. Answer only from provided context. " +
  "When answering, include paragraph citations using the canonical IDs exactly (e.g. 1.15 i, 4.71). " +
  "If the context is insufficient, say you cannot answer from the provided context. " +
  "If the context contains a direct rule, threshold, or condition that answers the question, state that answer explicitly in the first sentence and do not hedge.";

const PROMPT_FOOTER = [
  "RESPONSE FORMAT:",
  "- Start with a direct answer sentence.",
  "- If a numeric threshold/period exists in context, state it explicitly in that first sentence.",
  "- Do not say 'cannot find' or 'insufficient context' when cited context directly answers the question.",
  "- Answer concisely and clearly.",
  "- Include explicit citation IDs in the answer."
].join("\n");

export async function queryGoldGuide(
  question: string,
  client: Anthropic
): Promise<GoldGuideResult> {
  const startTime = Date.now();

  const retrievedChunks = await retrieveAll();
  const contextText = buildContext(retrievedChunks);

  const promptHeader = [
    "QUESTION:",
    question,
    "",
    "CANONICAL CONTEXT:",
    ""
  ].join("\n");

  // Prompt caching: mark the large context block as cacheable.
  // After the first call, Anthropic serves this block from cache at ~10× cheaper rate.
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    betas: ["prompt-caching-2024-07-31"],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptHeader },
          {
            type: "text",
            text: contextText,
            cache_control: { type: "ephemeral" }
          },
          { type: "text", text: PROMPT_FOOTER }
        ]
      }
    ]
  });

  const answer = extractAnswerText(
    response.content as Anthropic.ContentBlock[]
  );
  if (!answer) {
    throw new Error("Model returned an empty answer for Gold Guide query.");
  }

  const citations = extractCitations(answer, retrievedChunks);
  const usage = response.usage as unknown as Record<string, number>;

  return {
    answer,
    citations,
    retrievedChunks,
    pipelineUsed: "cag",
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0
    },
    latencyMs: Date.now() - startTime
  };
}
