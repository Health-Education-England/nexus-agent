/**
 * Cache-Augmented Generation (CAG) Pipeline
 *
 * Loads the entire Gold Guide document from the canonical JSONL file and
 * returns all chunks for every query. There is no vector retrieval — the full
 * document is injected into the LLM context window on every request.
 *
 * The in-memory cache (singleton Promise) means the file is read once per
 * process lifetime. Anthropic prompt caching further ensures that the large
 * context block is only billed at full rate on the first API call; subsequent
 * calls within the cache TTL are served at cache-read rates (~10x cheaper).
 *
 * Adapted from gold-guide-expert/core/retrieval/cag-pipeline.ts.
 * Key change: data path resolves relative to this file via import.meta.url
 * rather than process.cwd(), so the server works from any working directory.
 */

import type { RetrievedChunk } from "./types.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    // __dirname = gold-guide-server/src/core  →  ../../ = gold-guide-server/
    const filePath = path.resolve(
      __dirname,
      "../../data/raw/gold_guide_canonical.jsonl"
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

export async function retrieveAll(): Promise<RetrievedChunk[]> {
  return loadCanonicalChunks();
}
