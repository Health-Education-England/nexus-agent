/**
 * Evaluation Config
 *
 * Helpers for loading QA datasets and constructing PipelineConfigs
 * for evaluation runs.
 *
 * Pipeline configs now live in the shared registry (core/pipeline-registry.ts).
 * This file re-exports convenient aliases and handles dataset loading.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PipelineId } from "./pipeline-registry.js";
import type { QAItem, Severity } from "./types.js";

export const DATASET_NAMES = ["development", "frozen", "stress"] as const;
export type DatasetName = (typeof DATASET_NAMES)[number];

const VALID_SEVERITIES = new Set<Severity>(["CRITICAL", "HIGH", "LOW"]);

function assertString(
  value: unknown,
  fieldPath: string
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${fieldPath}: expected non-empty string.`);
  }
}

function assertStringArray(
  value: unknown,
  fieldPath: string,
  options?: { requireNonEmpty?: boolean }
): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new Error(`Invalid ${fieldPath}: expected array of strings.`);
  }

  if (options?.requireNonEmpty && value.length === 0) {
    throw new Error(`Invalid ${fieldPath}: expected at least one item.`);
  }
}

function assertSeverity(
  value: unknown,
  fieldPath: string
): asserts value is Severity {
  if (typeof value !== "string" || !VALID_SEVERITIES.has(value as Severity)) {
    throw new Error(`Invalid ${fieldPath}: expected one of CRITICAL/HIGH/LOW.`);
  }
}

function validateQAItem(value: unknown, index: number): QAItem {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid dataset item at index ${index}: expected object.`);
  }

  const record = value as Record<string, unknown>;

  assertString(record.id, `item[${index}].id`);
  assertString(record.question, `item[${index}].question`);
  assertString(record.expectedAnswer, `item[${index}].expectedAnswer`);
  assertStringArray(
    record.requiredCitations,
    `item[${index}].requiredCitations`,
    {
      requireNonEmpty: true
    }
  );
  assertSeverity(record.severity, `item[${index}].severity`);

  if (record.notes !== undefined && typeof record.notes !== "string") {
    throw new Error(
      `Invalid item[${index}].notes: expected string when provided.`
    );
  }

  if (record.tags !== undefined) {
    assertStringArray(record.tags, `item[${index}].tags`);
  }

  return {
    id: record.id,
    question: record.question,
    expectedAnswer: record.expectedAnswer,
    requiredCitations: record.requiredCitations,
    severity: record.severity,
    notes: record.notes,
    tags: record.tags
  };
}

/**
 * Load a QA dataset from the data/qa/ directory.
 */
export async function loadDataset(name: DatasetName): Promise<QAItem[]> {
  try {
    const filePath = path.join(
      process.cwd(),
      "gold-guide-expert/data/qa",
      `${name}.json`
    );
    const fileContents = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(fileContents) as unknown;

    if (!Array.isArray(parsed)) {
      throw new TypeError(`Dataset '${name}' must be a JSON array.`);
    }

    return parsed.map((item, index) => validateQAItem(item, index));
  } catch (error) {
    throw new Error(
      `Failed to load dataset '${name}': ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Convenience aliases mapping testing-phase steps to registry IDs.
 *
 * These point into PIPELINE_REGISTRY — no duplicated config values.
 * Add new aliases as you test new combinations.
 */
export const EVAL_PIPELINE_IDS = {
  /** CAG baseline — testing-phase step 5 */
  cagBaseline: "cag-sonnet-anthropic",

  /** Naive RAG — testing-phase step 6 */
  naiveRag: "naive-rag-sonnet-anthropic",

  /** Hybrid RAG — testing-phase step 7 */
  hybridRag: "hybrid-rag-sonnet-anthropic"
} as const satisfies Record<string, PipelineId>;

/** Re-export the full registry and lookup helper for direct use */
export { PIPELINE_REGISTRY, getPipelineConfig } from "./pipeline-registry.js";
export type { PipelineId } from "./pipeline-registry.js";
