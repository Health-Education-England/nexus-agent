// ── Evaluation Harness Types ──

import type { GoldGuideResult, PipelineConfig } from "../core/types.js";

/** Severity of a QA item — drives acceptance thresholds */
export type Severity = "CRITICAL" | "HIGH" | "LOW";

/**
 * A single item in a QA dataset (development, frozen, or stress set).
 */
export type QAItem = {
  /** Unique ID within the dataset */
  id: string;

  /** The user question */
  question: string;

  /** Gold-standard answer text */
  expectedAnswer: string;

  /** Required citation canonical IDs that must appear */
  requiredCitations: string[];

  /** Impact severity — determines pass/fail weighting */
  severity: Severity;

  /** Optional notes on ambiguity or edge cases */
  notes?: string;

  /** Tags for filtering (e.g. "multi-hop", "acronym", "adversarial") */
  tags?: string[];
};

/**
 * The scored result for a single QA item after evaluation.
 */
export type ScoredResult = {
  /** The QA item that was evaluated */
  qaItem: QAItem;

  /** The raw result from queryGoldGuide */
  result: GoldGuideResult;

  /** Scores assigned by the judge */
  scores: {
    /** Was the answer factually correct? (0–1) */
    correctness: number;

    /** Were the required citations present and accurate? (0–1) */
    citationPrecision: number;

    /** Was the answer complete — no important omissions? (0–1) */
    completeness: number;

    /** Did the answer contain hallucinated content? (0 = none, 1 = critical) */
    hallucinationSeverity: number;
  };

  /** Failure classification, if any */
  failureType?: FailureType;

  /** Metadata from the LLM judge */
  judgeMeta?: {
    confidence?: number;
    rationale?: string;
    /** Present only when the judge encountered an error */
    error?: string;
  };
};

/**
 * Failure taxonomy from research-finding-summary.txt §7.6
 */
export type FailureType =
  | "retrieval" // required source exists but was not retrieved
  | "synthesis" // correct passages retrieved but misapplied
  | "omission" // answer partly correct but misses key detail
  | "hallucination" // invented rule, number, or citation
  | "overconfidence" // incorrect answer stated with high certainty
  | "context-pressure"; // quality drops after deeper turn history

/**
 * Aggregated metrics for an entire evaluation run.
 */
export type EvalRunSummary = {
  /** Pipeline config used for this run */
  config: PipelineConfig;

  /** Dataset name (e.g. "development", "frozen", "stress") */
  dataset: string;

  /** Timestamp of the run */
  timestamp: string;

  /** Total items evaluated */
  totalItems: number;

  /** Per-item scored results */
  results: ScoredResult[];

  /** Aggregate metrics */
  metrics: {
    avgCorrectness: number;
    avgCitationPrecision: number;
    avgCompleteness: number;
    criticalHallucinations: number;
    totalLatencyMs: number;
    avgLatencyMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };

  /** Effective runtime model choices for this run */
  effectiveModels?: {
    answer: string;
    judge: string;
    answerOverridden: boolean;
    judgeOverridden: boolean;
  };
};
