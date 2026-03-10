/**
 * Judge
 *
 * Scores a single GoldGuideResult against its QA gold-standard item
 * using an LLM-as-judge approach (see research-finding-summary.txt §8).
 *
 * Human domain-expert review happens later — this is an automated first pass.
 */

import type { GoldGuideResult } from "../core/types.js";
import type { ModelProvider } from "../../providers/types.js";
import type { QAItem, ScoredResult } from "./types.js";

// ── Types ──

export type JudgeOptions = {
  provider: ModelProvider;
};

type LlmJudgePayload = {
  correctness: number;
  completeness: number;
  citationPrecision: number;
  hallucinationSeverity: number;
  failureType?: ScoredResult["failureType"];
  confidence?: number;
  rationale?: string;
};

// ── Helpers ──

function normalizeCitationRef(value: string): string {
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

function extractCitationRefs(result: GoldGuideResult): Set<string> {
  const refs = new Set<string>();
  const citationPattern =
    /(?:\b(?:paragraph|para|section)\s+)?(\d+(?:\.\d+)*(?:\s*[ivx]+)?)/gi;

  for (const citation of result.citations) {
    for (const value of [citation.canonicalId, citation.sectionRef]) {
      if (!value) continue;
      let match = citationPattern.exec(value);
      while (match) {
        refs.add(normalizeCitationRef(match[1] ?? ""));
        match = citationPattern.exec(value);
      }
      citationPattern.lastIndex = 0;
    }
  }

  let answerMatch = citationPattern.exec(result.answer);
  while (answerMatch) {
    refs.add(normalizeCitationRef(answerMatch[1] ?? ""));
    answerMatch = citationPattern.exec(result.answer);
  }

  return refs;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// ── LLM response parsing ──

function buildJudgePayload(
  parsed: Record<string, unknown>
): LlmJudgePayload | undefined {
  if (
    typeof parsed.correctness !== "number" ||
    typeof parsed.completeness !== "number" ||
    typeof parsed.citationPrecision !== "number" ||
    typeof parsed.hallucinationSeverity !== "number"
  ) {
    return undefined;
  }

  const payload: LlmJudgePayload = {
    correctness: clampScore(parsed.correctness),
    completeness: clampScore(parsed.completeness),
    citationPrecision: clampScore(parsed.citationPrecision),
    hallucinationSeverity: clampScore(parsed.hallucinationSeverity)
  };

  if (typeof parsed.failureType === "string") {
    payload.failureType = parsed.failureType as ScoredResult["failureType"];
  }
  if (typeof parsed.confidence === "number") {
    payload.confidence = clampScore(parsed.confidence);
  }
  if (typeof parsed.rationale === "string" && parsed.rationale.trim()) {
    payload.rationale = parsed.rationale.trim();
  }

  return payload;
}

function tryParseJudgePayload(text: string): LlmJudgePayload | undefined {
  const trimmed = text.trim();
  const candidates = [trimmed];

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const objectLike = /\{[\s\S]*\}/.exec(trimmed);
  if (objectLike?.[0]) candidates.push(objectLike[0].trim());

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>;
      const payload = buildJudgePayload(parsed);
      if (payload) return payload;
    } catch {
      // try next candidate
    }
  }

  return undefined;
}

// ── LLM scoring call ──

async function llmScore(
  qaItem: QAItem,
  result: GoldGuideResult,
  provider: ModelProvider
): Promise<LlmJudgePayload | undefined> {
  const observedCitations = [...extractCitationRefs(result)];

  const prompt = [
    "You are grading a Gold Guide QA response.",
    "Return JSON only — no surrounding text.",
    "",
    "Score based on semantic correctness, not strict wording overlap.",
    "Treat logically equivalent phrasings as correct.",
    "For threshold questions, if policy says review is triggered for 'more than N', then phrasing like 'N before review' can be equivalent and should not be penalized.",
    "Only mark synthesis/correctness down when the answer is materially inconsistent with the policy, not when it is a valid paraphrase.",
    "",
    "JSON schema:",
    "{",
    '  "correctness": number(0..1),',
    '  "completeness": number(0..1),',
    '  "citationPrecision": number(0..1),',
    '  "hallucinationSeverity": number(0..1),',
    '  "failureType": "retrieval"|"synthesis"|"omission"|"hallucination"|"overconfidence"|"context-pressure"|null,',
    '  "confidence": number(0..1),',
    '  "rationale": string',
    "}",
    "",
    "Field guidance:",
    "- correctness: Is the answer factually correct per the Gold Guide?",
    "- completeness: Does the answer cover all key points without important omissions?",
    "- citationPrecision: Do the cited references match the required citations? 1 = all required citations present, 0 = none.",
    "- hallucinationSeverity: 0 = no hallucination, 1 = critical hallucination (invented rules/numbers/citations).",
    "",
    "Question:",
    qaItem.question,
    "",
    "Expected Answer:",
    qaItem.expectedAnswer,
    "",
    "Required Citations:",
    JSON.stringify(qaItem.requiredCitations),
    "",
    "Model Answer:",
    result.answer,
    "",
    "Model Citations:",
    JSON.stringify(observedCitations)
  ].join("\n");

  const response = await provider.generateResponse(
    [{ role: "user", content: prompt }],
    []
  );

  const text = response.content
    .filter(block => block.type === "text")
    .map(block => block.text)
    .join("\n");

  return tryParseJudgePayload(text);
}

// ── Zero-score fallback for errors ──

function zeroScoreResult(
  qaItem: QAItem,
  result: GoldGuideResult,
  reason: string
): ScoredResult {
  return {
    qaItem,
    result,
    scores: {
      correctness: 0,
      citationPrecision: 0,
      completeness: 0,
      hallucinationSeverity: 0
    },
    judgeMeta: { error: reason }
  };
}

// ── Public API ──

/**
 * Score a single result against its gold-standard QA item using LLM-as-judge.
 */
export async function judge(
  qaItem: QAItem,
  result: GoldGuideResult,
  options: JudgeOptions
): Promise<ScoredResult> {
  try {
    const payload = await llmScore(qaItem, result, options.provider);

    if (!payload) {
      return zeroScoreResult(qaItem, result, "llm-unparseable");
    }

    return {
      qaItem,
      result,
      scores: {
        correctness: payload.correctness,
        citationPrecision: payload.citationPrecision,
        completeness: payload.completeness,
        hallucinationSeverity: payload.hallucinationSeverity
      },
      failureType: payload.failureType,
      judgeMeta: {
        confidence: payload.confidence,
        rationale: payload.rationale
      }
    };
  } catch (error) {
    const reason =
      error instanceof Error ? `llm-error: ${error.message}` : "llm-error";
    return zeroScoreResult(qaItem, result, reason);
  }
}
