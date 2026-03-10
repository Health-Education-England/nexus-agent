/**
 * Vector Ingestion Script
 *
 * Reads the canonical JSONL chunks, embeds each one via Ollama,
 * and upserts them into Qdrant.
 *
 * Prerequisites:
 *   1. Ollama running with the embedding model pulled:
 *        ollama pull qwen3-embedding:8b
 *   2. Qdrant running via Docker:
 *        docker compose up -d
 *
 * Usage:
 *   npm run rag:ingest
 *   npm run rag:ingest -- --force    # re-ingest even if collection exists
 *   npm run rag:ingest -- --model qwen3-embedding:0.6b   # use a different model
 *   npm run rag:ingest -- --dims 2048                     # custom output dimensions
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { getEmbeddingProvider } from "../core/retrieval/embeddings/index.js";
import { getVectorStore } from "../core/retrieval/vector-store/index.js";

type CanonicalRecord = {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
};

// ── CLI args ──

const args = process.argv.slice(2);
const force = args.includes("--force");

const modelArgIndex = args.indexOf("--model");
const modelName =
  modelArgIndex !== -1 && args[modelArgIndex + 1]
    ? args[modelArgIndex + 1]
    : undefined;

const collectionArgIndex = args.indexOf("--collection");
const collectionName =
  collectionArgIndex !== -1 && args[collectionArgIndex + 1]
    ? args[collectionArgIndex + 1]
    : "gold-guide";

const dimsArgIndex = args.indexOf("--dims");
const outputDimensions =
  dimsArgIndex !== -1 && args[dimsArgIndex + 1]
    ? Number.parseInt(args[dimsArgIndex + 1], 10)
    : undefined;

// ── Batch size for embedding + upsert ──
const EMBED_BATCH_SIZE = 50;

async function main(): Promise<void> {
  const startTime = Date.now();

  // 1. Initialise providers
  const embedder = getEmbeddingProvider(modelName, { outputDimensions });
  const store = getVectorStore();

  console.log(
    `Embedding model : ${embedder.modelName} (${embedder.dimensions}d)`
  );
  console.log(`Vector store    : Qdrant`);
  console.log(`Collection      : ${collectionName}`);

  // 2. Check if collection already has data
  const info = await store.collectionInfo(collectionName);
  if (info.exists && info.pointCount > 0 && !force) {
    console.log(
      `\nCollection '${collectionName}' already has ${info.pointCount} points.` +
        `\nUse --force to re-ingest. Exiting.`
    );
    return;
  }

  // 3. Ensure collection exists
  await store.ensureCollection(collectionName, embedder.dimensions);
  console.log(`\nCollection '${collectionName}' ready.`);

  // 4. Load canonical chunks
  const jsonlPath = path.join(
    process.cwd(),
    "gold-guide-expert/data/raw/gold_guide_canonical.jsonl"
  );
  const fileContents = await readFile(jsonlPath, "utf-8");
  const lines = fileContents
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const records: CanonicalRecord[] = lines.map((line, i) => {
    try {
      return JSON.parse(line) as CanonicalRecord;
    } catch (error) {
      throw new Error(
        `Failed to parse JSONL line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  console.log(`Loaded ${records.length} canonical chunks from JSONL.\n`);

  // 5. Embed + upsert in batches
  let totalUpserted = 0;

  for (let i = 0; i < records.length; i += EMBED_BATCH_SIZE) {
    const batch = records.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map(r => r.text);

    // Embed
    const vectors = await embedder.embed(texts);

    // Build documents for upsert.
    // Qdrant requires either string UUIDs or unsigned integers as IDs.
    // We use the batch index offset as a stable unsigned integer ID,
    // and store the canonical ID in the payload for retrieval.
    const documents = batch.map((record, j) => ({
      id: i + j,
      vector: vectors[j],
      payload: {
        canonicalId: record.id,
        content: record.text,
        ...record.metadata
      }
    }));

    await store.upsert(collectionName, documents);

    totalUpserted += batch.length;
    const pct = ((totalUpserted / records.length) * 100).toFixed(0);
    process.stdout.write(
      `\r  Ingested ${totalUpserted}/${records.length} chunks (${pct}%)`
    );
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(
    `\n\nIngestion complete. ${totalUpserted} chunks → '${collectionName}' in ${elapsed}s.`
  );
}

try {
  await main();
} catch (error) {
  if (error instanceof Error) {
    console.error("Ingestion failed:", error.message);
    if (error.stack) console.error(error.stack);
  } else {
    console.error("Ingestion failed:", error);
  }
  process.exit(1);
}
