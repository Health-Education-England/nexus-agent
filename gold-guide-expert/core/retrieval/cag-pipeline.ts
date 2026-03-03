/**
 * Cache-Augmented Generation (CAG) Pipeline
 *
 * Intent:
 * This pipeline implements the CAG strategy where the entire Gold Guide
 * document is injected into the LLM context window. It skips traditional
 * vector chunk retrieval entirely.
 *
 * Architectural Role:
 * Used primarily to establish an "LLM reasoning baseline" (Step 5 of the test plan).
 * By providing the full text, we isolate LLM reasoning failures from
 * retrieval failures. If the LLM fails with CAG, the problem is understanding
 * the policy; if it succeeds here but fails in RAG, the problem is our retrieval.
 */

import type {
  RetrievalPipeline,
  RetrievedChunk,
  PipelineConfig
} from "../types.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

type CanonicalRecord = {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
};

let canonicalChunksCache: Promise<RetrievedChunk[]> | undefined;

async function loadCanonicalChunks(): Promise<RetrievedChunk[]> {
  if (canonicalChunksCache) {
    return canonicalChunksCache;
  }

  canonicalChunksCache = (async () => {
    const filePath = path.join(
      process.cwd(),
      "gold-guide-expert/data/raw/gold_guide_canonical.jsonl"
    );

    const fileContents = await readFile(filePath, "utf-8");
    const lines = fileContents
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const chunks: RetrievedChunk[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      let parsed: CanonicalRecord;
      try {
        parsed = JSON.parse(line) as CanonicalRecord;
      } catch (error) {
        throw new Error(
          `Failed to parse canonical JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      if (!parsed.id || !parsed.text) {
        throw new Error(
          `Invalid canonical record at line ${index + 1}: expected id and text.`
        );
      }

      chunks.push({
        canonicalId: parsed.id,
        content: parsed.text,
        score: 1,
        metadata: parsed.metadata
      });
    }

    return chunks;
  })();

  return canonicalChunksCache;
}

export class CagPipeline implements RetrievalPipeline {
  readonly name = "cag" as const;

  async retrieve(
    _query: string,
    _config: PipelineConfig
  ): Promise<RetrievedChunk[]> {
    return loadCanonicalChunks();
  }
}
