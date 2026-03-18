/**
 * Gold Guide MCP Server
 *
 * Exposes:
 *  - Tool: ask_gold_guide (text-only, no App UI)
 *
 * Transport: Streamable HTTP on Express (port 3002, path /mcp).
 *
 * Pipeline: CAG — full Gold Guide injected per request, Anthropic prompt
 * caching keeps repeat calls cheap after the first turn.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Resolve .env from the mcp-app-host parent directory so the key is available
// regardless of which directory npm was invoked from.
const __envDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__envDir, "../../../.env") });
import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { queryGoldGuide } from "../core/query-gold-guide.js";
import { retrieveAll } from "../core/cag-pipeline.js";
import type { Citation, GoldGuideResult } from "../core/types.js";

const PORT = Number(process.env.GOLD_GUIDE_PORT) || 3002;

// ── Anthropic client (shared across all sessions) ────────────────────

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ── Result formatter (tool-facing: ANSWER + CITATIONS, no internal metadata) ──

function formatResultForTool(result: GoldGuideResult): string {
  const lines: string[] = ["ANSWER:", result.answer];

  if (result.citations.length > 0) {
    lines.push(
      "",
      "CITATIONS:",
      ...result.citations.map((c: Citation) => {
        const ref = c.sectionRef ?? c.canonicalId;
        return `- [${ref}] ${c.sourceText?.slice(0, 200) ?? ""}`;
      })
    );
  }

  return lines.join("\n");
}

// ── MCP Server factory ────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "Gold Guide Expert",
    version: "1.0.0"
  });

  server.registerTool(
    "ask_gold_guide",
    {
      description: `Purpose: Answer policy and guidance questions about UK postgraduate medical training using the official Gold Guide with citations.

Use this tool when:
- The user asks about training rules, policy, eligibility, process, requirements, or definitions
- The topic is LTFT, OOP, ARCP, rotations, extensions, progression, or similar guidance questions
- The user wants an explanation rather than a calculation or form

Do not use this tool when:
- The user explicitly wants to calculate a new CCT date
- The user asks to open or use the LTFT calculator

Response characteristics:
- Returns an accurate answer drawn from the Gold Guide 10th Edition
- Includes inline citation IDs and a CITATIONS block
- Best tool for general LTFT questions such as "What is LTFT?", "Am I eligible?", or "How does LTFT work?"`,
      inputSchema: {
        question: z
          .string()
          .describe("The policy question to answer, in natural language.")
      }
    },
    async (args: { question: string }) => {
      try {
        const result = await queryGoldGuide(args.question, anthropicClient);
        return {
          content: [
            { type: "text" as const, text: formatResultForTool(result) }
          ]
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true
        };
      }
    }
  );

  return server;
}

// ── Express + Streamable HTTP Transport ──────────────────────────────

const app = express();

app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "mcp-session-id", "mcp-protocol-version"],
    exposedHeaders: ["mcp-session-id"]
  })
);
app.use(express.json());

// Store transports by session ID for stateful connections
const transports = new Map<string, StreamableHTTPServerTransport>();

app.all("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // Only POST can create a new session (initialize handshake).
  if (req.method !== "POST") {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "No active session. Send initialize first."
      },
      id: null
    });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID()
  });

  transport.onclose = () => {
    if (transport.sessionId) {
      transports.delete(transport.sessionId);
    }
  };

  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);

  if (transport.sessionId) {
    transports.set(transport.sessionId, transport);
  }
});

// Pre-load chunks at startup so the first query is fast, and log the count.
try {
  const chunks = await retrieveAll();
  console.log(
    `[Gold Guide MCP Server] data ready — ${chunks.length} canonical chunks loaded`
  );
} catch (err) {
  console.error(
    "[Gold Guide MCP Server] FATAL: failed to load canonical chunks:",
    err
  );
  process.exit(1);
}

app.listen(PORT, () => {
  const portSource = process.env.GOLD_GUIDE_PORT
    ? "$GOLD_GUIDE_PORT"
    : "default";
  const apiKeyStatus = process.env.ANTHROPIC_API_KEY
    ? "present"
    : "MISSING — set ANTHROPIC_API_KEY";
  console.log(
    `[Gold Guide MCP Server] listening on http://localhost:${PORT}/mcp (port: ${portSource})`
  );
  console.log(`[Gold Guide MCP Server] model:      claude-haiku-4-5-20251001`);
  console.log(
    `[Gold Guide MCP Server] pipeline:   CAG — full document injection (~80K tokens), prompt caching active`
  );
  console.log(`[Gold Guide MCP Server] API key:    ${apiKeyStatus}`);
  console.log(`[Gold Guide MCP Server] tool:       ask_gold_guide`);
});
