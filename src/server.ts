import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "./agent/agent.js";
import {
  createProviderFromEnv,
  createAnthropicProvider,
  createOllamaProvider
} from "../providers/provider-factory.js";
import { MAX_TOKENS } from "./agent/constants.js";
import {
  DateTimeTool,
  LtftCalculatorTool,
  ShowLtftFormTool,
  createGoldGuideExpertTool
} from "./tools/index.js";
import { PRODUCTION_CONFIG } from "../gold-guide-expert/sub-agent/index.js";
import type { Message } from "../providers/types.js";
import type { AgentEvent } from "./agent/agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

// ── Providers & tools (mirrors main.ts) ──────────────────────────────────────

const { provider, providerName, model } = createProviderFromEnv(MAX_TOKENS);
console.log(`Using provider: ${providerName} (orchestrator model: ${model})`);

const subAgentModel = PRODUCTION_CONFIG.models.answer;
const subAgentProvider =
  PRODUCTION_CONFIG.provider === "ollama"
    ? createOllamaProvider(subAgentModel, MAX_TOKENS)
    : createAnthropicProvider(subAgentModel, MAX_TOKENS);
console.log(
  `Gold Guide sub-agent model: ${subAgentModel} (${PRODUCTION_CONFIG.provider})`
);

const tools = [
  DateTimeTool,
  ShowLtftFormTool,
  LtftCalculatorTool,
  createGoldGuideExpertTool({ provider: subAgentProvider })
];

// getUserMessage is unused in the web server path (stream() is called directly)
const agent = new Agent(provider, async () => null, tools);

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "1mb" }));

const staticDirCandidates = [
  path.join(__dirname, "public"),
  path.join(process.cwd(), "src", "public"),
  path.join(process.cwd(), "public")
];
const staticDir =
  staticDirCandidates.find(candidate => existsSync(candidate)) ??
  staticDirCandidates[0];
app.use(
  express.static(staticDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".js") || filePath.endsWith(".css")) {
        res.setHeader("Cache-Control", "no-store");
      }
    }
  })
);

const CONVERSATIONS_DIR = path.join(process.cwd(), "conversations");

/** Derive a conversation title from the first human-typed message. */
function deriveTitle(messages: Message[]): string {
  const first = messages.find(
    m => m.role === "user" && typeof m.content === "string"
  );
  if (!first || typeof first.content !== "string")
    return "Untitled conversation";
  return first.content.length > 80
    ? first.content.slice(0, 80) + "\u2026"
    : first.content;
}

/**
 * GET /conversations
 * Returns a summary list of all saved conversations, newest first.
 */
app.get("/conversations", async (_req, res) => {
  try {
    await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });
    const files = await fs.readdir(CONVERSATIONS_DIR);
    const summaries = await Promise.all(
      files
        .filter(f => f.startsWith("conversation-") && f.endsWith(".json"))
        .map(async filename => {
          const id = filename
            .replace(/^conversation-/, "")
            .replace(/\.json$/, "");
          const filePath = path.join(CONVERSATIONS_DIR, filename);
          try {
            const [raw, stat] = await Promise.all([
              fs.readFile(filePath, "utf-8"),
              fs.stat(filePath)
            ]);
            const messages: Message[] = JSON.parse(raw);
            const userTurns = messages.filter(
              m => m.role === "user" && typeof m.content === "string"
            ).length;
            return {
              id,
              title: deriveTitle(messages),
              messageCount: userTurns,
              updatedAt: stat.mtime.toISOString()
            };
          } catch {
            return null;
          }
        })
    );
    const valid = summaries
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    res.json(valid);
  } catch {
    res.json([]);
  }
});

/**
 * GET /conversations/:id
 * Returns the full message history for a single conversation.
 */
app.get("/conversations/:id", async (req, res) => {
  // Sanitise to prevent path traversal
  const id = req.params.id.replaceAll(/[^a-zA-Z0-9\-_]/g, "");
  const filePath = path.join(CONVERSATIONS_DIR, `conversation-${id}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const messages: Message[] = JSON.parse(raw);
    res.json({ id, messages });
  } catch {
    res.status(404).json({ error: "Conversation not found" });
  }
});

/**
 * DELETE /conversations/:id
 * Deletes a single saved conversation.
 */
app.delete("/conversations/:id", async (req, res) => {
  const id = req.params.id.replaceAll(/[^a-zA-Z0-9\-_]/g, "");
  const filePath = path.join(CONVERSATIONS_DIR, `conversation-${id}.json`);
  try {
    await fs.unlink(filePath);
    res.status(204).send();
  } catch {
    res.status(404).json({ error: "Conversation not found" });
  }
});

/**
 * POST /chat
 * Body: { message: string, history: Message[], conversationId?: string }
 * Response: text/event-stream — newline-delimited SSE
 *   data: AgentEvent JSON\n\n
 *   ...
 *   data: { type: "done", history: Message[], conversationId: string }\n\n
 */
app.post("/chat", async (req, res) => {
  const { message, history, conversationId } = req.body as {
    message?: unknown;
    history?: unknown;
    conversationId?: unknown;
  };

  if (!message || typeof message !== "string" || message.trim() === "") {
    res.status(400).json({ error: "message must be a non-empty string" });
    return;
  }

  const safeHistory = Array.isArray(history) ? (history as Message[]) : [];
  // Use the client-provided ID or generate a fresh timestamp-based one
  const convId =
    typeof conversationId === "string" && conversationId.trim()
      ? conversationId.trim().replaceAll(/[^a-zA-Z0-9\-_]/g, "")
      : new Date().toISOString().replaceAll(/[:.]/g, "-");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (
    event:
      | AgentEvent
      | { type: "done"; history: Message[]; conversationId: string }
  ) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const updatedHistory = await agent.stream(
      safeHistory,
      message.trim(),
      send
    );

    // Auto-save to disk after every turn
    await fs.mkdir(CONVERSATIONS_DIR, { recursive: true });
    await fs.writeFile(
      path.join(CONVERSATIONS_DIR, `conversation-${convId}.json`),
      JSON.stringify(updatedHistory, null, 2)
    );

    send({ type: "done", history: updatedHistory, conversationId: convId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    send({ type: "error", message: msg });
  }

  res.end();
});

app.listen(PORT, () => {
  console.log(`\nNexus Agent web UI → http://localhost:${PORT}\n`);
});
