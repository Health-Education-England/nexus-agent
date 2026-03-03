import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type ModelInfo = {
  id: string;
  display_name: string;
  created_at: string;
  type: string;
};

type ListModelsResponse = {
  data: ModelInfo[];
  first_id: string;
  last_id: string;
  has_more: boolean;
};

function parseLimit(argv: string[]): number | undefined {
  const index = argv.indexOf("--limit");
  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];
  if (!value) {
    throw new TypeError("Missing value for --limit");
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TypeError("--limit must be a positive integer");
  }

  return parsed;
}

function parseStringOption(
  argv: string[],
  optionName: "--after-id" | "--before-id" | "--out"
): string | undefined {
  const index = argv.indexOf(optionName);
  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new TypeError(`Missing value for ${optionName}`);
  }

  return value;
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const argv = process.argv.slice(2);
  const limit = parseLimit(argv);
  const afterId = parseStringOption(argv, "--after-id");
  const beforeId = parseStringOption(argv, "--before-id");
  const outPathArg = parseStringOption(argv, "--out");

  if (afterId && beforeId) {
    throw new TypeError("Use only one of --after-id or --before-id");
  }

  const params = new URLSearchParams();
  if (limit) {
    params.set("limit", String(limit));
  }
  if (afterId) {
    params.set("after_id", afterId);
  }
  if (beforeId) {
    params.set("before_id", beforeId);
  }

  const query = params.size > 0 ? `?${params.toString()}` : "";
  const url = `https://api.anthropic.com/v1/models${query}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${body}`);
  }

  const payload = (await response.json()) as ListModelsResponse;

  const outputPath = outPathArg
    ? path.resolve(process.cwd(), outPathArg)
    : path.join(
        process.cwd(),
        "gold-guide-expert",
        "data",
        "metadata",
        "anthropic-models.json"
      );

  const filePayload = {
    fetchedAt: new Date().toISOString(),
    request: {
      limit,
      afterId,
      beforeId,
      url
    },
    response: payload
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(filePayload, null, 2)}\n`,
    "utf-8"
  );

  console.log(
    `[models] count=${payload.data.length} has_more=${payload.has_more}`
  );
  for (const model of payload.data) {
    console.log(`${model.id}\t${model.display_name}\t${model.created_at}`);
  }

  if (payload.has_more) {
    console.log(`[models] next_page_after_id=${payload.last_id}`);
  }

  if (payload.first_id) {
    console.log(`[models] prev_page_before_id=${payload.first_id}`);
  }

  console.log(`[models] output=${outputPath}`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[models] ${message}`);
  process.exitCode = 1;
}
