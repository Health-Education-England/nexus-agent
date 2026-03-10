/**
 * Evaluation Runner
 *
 * Reads a QA dataset, runs each question through queryGoldGuide
 * with the specified PipelineConfig, collects results, and hands
 * them to the LLM judge for scoring.
 *
 * Usage:
 *   npx tsx gold-guide-expert/evaluation/runner.ts --dataset development --pipeline cagBaseline
 */

import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { formatErrorCauseSuffix, formatUnknownError } from "../core/errors.js";
import type { PipelineConfig, GoldGuideResult } from "../core/types.js";
import type { QAItem, EvalRunSummary } from "./types.js";
import type { ModelProvider } from "../../providers/types.js";
import type { PromptCacheTTL } from "../../providers/anthropic.js";
import { queryGoldGuide } from "../core/index.js";
import { judge } from "./judge.js";
import { computeMetrics } from "./metrics.js";
import { AnthropicProvider } from "../../providers/anthropic.js";
import { BedrockProvider } from "../../providers/bedrock.js";
import { OllamaProvider } from "../../providers/ollama.js";
import {
  DATASET_NAMES,
  EVAL_PIPELINE_IDS,
  getPipelineConfig,
  loadDataset,
  type DatasetName
} from "./config.js";

// ── CLI argument parsing ──

type EvalCliArgs = {
  dataset: DatasetName;
  pipeline: keyof typeof EVAL_PIPELINE_IDS;
  questionId?: string;
  limit?: number;
  modelOverride?: string;
  judgeModelOverride?: string;
};

function parseOptionArgs(argv: string[]): Map<string, string> {
  const options = new Map<string, string>();

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      index += 1;
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TypeError(`Missing value for '--${key}'.`);
    }

    options.set(key, value);
    index += 2;
  }

  return options;
}

function isDatasetName(value: string): value is DatasetName {
  return DATASET_NAMES.includes(value as DatasetName);
}

function isPipelineAlias(
  value: string
): value is keyof typeof EVAL_PIPELINE_IDS {
  return value in EVAL_PIPELINE_IDS;
}

export function parseEvalCliArgs(argv: string[]): EvalCliArgs {
  const options = parseOptionArgs(argv);

  const datasetValue = options.get("dataset") ?? "development";
  const pipelineValue = options.get("pipeline") ?? "cagBaseline";
  const questionIdValue = options.get("id");
  const limitValue = options.get("limit");
  const modelValue = options.get("model");
  const judgeModelValue = options.get("judge-model");

  if (!isDatasetName(datasetValue)) {
    throw new TypeError(
      `Invalid --dataset '${datasetValue}'. Valid options: ${DATASET_NAMES.join(", ")}.`
    );
  }

  if (!isPipelineAlias(pipelineValue)) {
    throw new TypeError(
      `Invalid --pipeline '${pipelineValue}'. Valid options: ${Object.keys(EVAL_PIPELINE_IDS).join(", ")}.`
    );
  }

  let limit: number | undefined;
  if (limitValue !== undefined) {
    const parsedLimit = Number.parseInt(limitValue, 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new TypeError(
        `Invalid --limit '${limitValue}'. Expected a positive integer.`
      );
    }
    limit = parsedLimit;
  }

  return {
    dataset: datasetValue,
    pipeline: pipelineValue,
    questionId: questionIdValue,
    limit,
    modelOverride: modelValue?.trim() || undefined,
    judgeModelOverride: judgeModelValue?.trim() || undefined
  };
}

export async function loadDatasetFromCliArgs(
  argv: string[]
): Promise<QAItem[]> {
  const { dataset } = parseEvalCliArgs(argv);
  return loadDataset(dataset);
}

// ── Provider creation ──

function normalizePromptCacheTTL(
  value: string | undefined
): PromptCacheTTL | undefined {
  if (!value?.trim()) return undefined;
  const ttl = value.trim().toLowerCase();
  if (ttl === "5m" || ttl === "1h") return ttl;
  throw new Error(
    `Unsupported ANTHROPIC_PROMPT_CACHE_TTL '${value}'. Supported values: 5m, 1h`
  );
}

function createProvider(config: PipelineConfig, model: string): ModelProvider {
  const promptCacheTTL = normalizePromptCacheTTL(
    process.env.ANTHROPIC_PROMPT_CACHE_TTL
  );

  if (config.provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required.");
    return new AnthropicProvider(new Anthropic({ apiKey }), {
      model,
      maxTokens: 2048,
      promptCacheTTL
    });
  }

  if (config.provider === "bedrock") {
    const region = process.env.AWS_REGION;
    if (!region) throw new Error("AWS_REGION is required.");
    return new BedrockProvider({ model, maxTokens: 2048, region });
  }

  if (config.provider === "ollama") {
    const baseUrl = process.env.OLLAMA_BASE_URL;
    const numCtx = process.env.OLLAMA_NUM_CTX
      ? Number.parseInt(process.env.OLLAMA_NUM_CTX, 10)
      : undefined;
    const maxTokens = process.env.OLLAMA_MAX_TOKENS
      ? Number.parseInt(process.env.OLLAMA_MAX_TOKENS, 10)
      : 4096;
    return new OllamaProvider({
      model,
      maxTokens,
      baseUrl,
      numCtx,
      temperature: 0
    });
  }

  throw new Error(`Unsupported provider '${config.provider}'.`);
}

/**
 * Resolve the effective model ID for a role, applying CLI overrides.
 */
function resolveModel(
  config: PipelineConfig,
  role: "answer" | "judge",
  override?: string
): string {
  if (override) return override;
  if (role === "judge") return config.models.judge ?? config.models.answer;
  return config.models.answer;
}

// ── Evaluation run ──

function createErrorResult(
  message: string,
  config: PipelineConfig
): GoldGuideResult {
  return {
    answer: `Evaluation item failed: ${message}`,
    citations: [],
    retrievedChunks: [],
    pipelineUsed: config.pipeline,
    usage: { inputTokens: 0, outputTokens: 0 },
    latencyMs: 0
  };
}

/**
 * Run a full evaluation pass over a QA dataset.
 */
export async function runEvaluation(
  dataset: QAItem[],
  config: PipelineConfig,
  answerProvider: ModelProvider,
  judgeProvider: ModelProvider,
  datasetName: DatasetName
): Promise<EvalRunSummary> {
  const scoredResults = [];

  for (const qaItem of dataset) {
    try {
      const result = await queryGoldGuide(
        qaItem.question,
        config,
        answerProvider
      );
      const scored = await judge(qaItem, result, { provider: judgeProvider });
      scoredResults.push(scored);
    } catch (error) {
      const message = formatUnknownError(error);
      const cause = formatErrorCauseSuffix(error);
      console.error(`\n[eval] ERROR on ${qaItem.id}: ${message}${cause}`);
      if (error instanceof Error && error.stack) {
        console.error(
          `[eval] Stack: ${error.stack.split("\n").slice(0, 5).join("\n")}`
        );
      }
      const fallbackResult = createErrorResult(message, config);
      scoredResults.push({
        qaItem,
        result: fallbackResult,
        scores: {
          correctness: 0,
          citationPrecision: 0,
          completeness: 0,
          hallucinationSeverity: 0
        },
        judgeMeta: { error: `query-error: ${message}${cause}` }
      });
    }
  }

  return {
    config,
    dataset: datasetName,
    timestamp: new Date().toISOString(),
    totalItems: scoredResults.length,
    results: scoredResults,
    metrics: computeMetrics(scoredResults)
  };
}

// ── Output ──

async function writeEvalSummary(summary: EvalRunSummary): Promise<string> {
  const timestamp = summary.timestamp.replaceAll(/[:.]/g, "-");
  const fileName = `evaluation-results-${summary.dataset}-${summary.config.pipeline}-${timestamp}.json`;
  const outputPath = path.join(
    process.cwd(),
    "gold-guide-expert",
    "evaluation",
    "results",
    fileName
  );

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");

  return outputPath;
}

function selectDatasetItems(dataset: QAItem[], args: EvalCliArgs): QAItem[] {
  let selected = dataset;

  if (args.questionId) {
    selected = selected.filter(item => item.id === args.questionId);
    if (selected.length === 0) {
      throw new Error(`No QA item found with --id '${args.questionId}'.`);
    }
  }

  if (args.limit !== undefined) {
    selected = selected.slice(0, args.limit);
  }

  if (selected.length === 0) {
    throw new Error("No QA items selected for evaluation.");
  }

  return selected;
}

// ── CLI entry point ──

async function main(argv: string[]): Promise<void> {
  const args = parseEvalCliArgs(argv);
  const { dataset, pipeline, modelOverride, judgeModelOverride } = args;
  const pipelineId = EVAL_PIPELINE_IDS[pipeline];
  const config = getPipelineConfig(pipelineId);

  const effectiveAnswerModel = resolveModel(config, "answer", modelOverride);
  const effectiveJudgeModel = resolveModel(config, "judge", judgeModelOverride);

  const answerProvider = createProvider(config, effectiveAnswerModel);
  const judgeProvider =
    effectiveJudgeModel === effectiveAnswerModel
      ? answerProvider
      : createProvider(config, effectiveJudgeModel);

  const qaItems = await loadDataset(dataset);
  const selectedQaItems = selectDatasetItems(qaItems, args);

  const summary = await runEvaluation(
    selectedQaItems,
    config,
    answerProvider,
    judgeProvider,
    dataset
  );

  summary.effectiveModels = {
    answer: effectiveAnswerModel,
    judge: effectiveJudgeModel,
    answerOverridden: modelOverride !== undefined,
    judgeOverridden: judgeModelOverride !== undefined
  };

  const outputPath = await writeEvalSummary(summary);

  console.log("[eval] Harness run complete");
  console.log(
    `[eval] dataset=${dataset} selectedItems=${selectedQaItems.length} totalDatasetItems=${qaItems.length}`
  );
  if (args.questionId) console.log(`[eval] filter id=${args.questionId}`);
  if (args.limit !== undefined)
    console.log(`[eval] filter limit=${args.limit}`);
  if (modelOverride) console.log(`[eval] modelOverride=${modelOverride}`);
  if (judgeModelOverride)
    console.log(`[eval] judgeModelOverride=${judgeModelOverride}`);
  console.log(`[eval] effectiveAnswerModel=${effectiveAnswerModel}`);
  console.log(`[eval] effectiveJudgeModel=${effectiveJudgeModel}`);
  console.log(`[eval] pipelineAlias=${pipeline} pipelineId=${pipelineId}`);
  console.log(
    `[eval] metrics correctness=${summary.metrics.avgCorrectness.toFixed(3)} citation=${summary.metrics.avgCitationPrecision.toFixed(3)} completeness=${summary.metrics.avgCompleteness.toFixed(3)}`
  );
  console.log(`[eval] output=${outputPath}`);
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    const message = formatUnknownError(error);
    console.error(`[eval] ${message}`);
    process.exitCode = 1;
  }
}
