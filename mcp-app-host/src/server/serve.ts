#!/usr/bin/env npx tsx
/**
 * HTTP servers for the MCP App Host:
 * - Host server (port 8080): serves chat UI + agent API
 * - Sandbox server (port 8081): serves sandbox.html with CSP headers
 *
 * Running on separate ports ensures proper origin isolation for security.
 * Adapted from: https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/basic-host/serve.ts
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";
import { handleChat, conversationStore, resetSession } from "./agent.js";
import { connectToServers, getConnectedServers } from "./mcp-client.js";
import { loadSkills } from "./skills-registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOST_PORT = Number.parseInt(process.env.HOST_PORT || "8080", 10);
const SANDBOX_PORT = Number.parseInt(process.env.SANDBOX_PORT || "8081", 10);
const DIST_DIR = join(__dirname, "..", "..", "dist");
const SERVERS: string[] = process.env.SERVERS
  ? JSON.parse(process.env.SERVERS)
  : ["http://localhost:3001/mcp", "http://localhost:3002/mcp"];

/** Max age (days) for conversation retention. Override with CONVERSATION_MAX_AGE_DAYS env var. */
const CONVERSATION_MAX_AGE_DAYS = Number.parseInt(
  process.env.CONVERSATION_MAX_AGE_DAYS || "30",
  10
);

// ============ Host Server (port 8080) ============
const hostApp = express();
hostApp.use(cors());
hostApp.use(express.json());

// Exclude sandbox.html from host server
hostApp.use((req, res, next) => {
  if (req.path === "/sandbox.html") {
    res.status(404).send("Sandbox is served on a different port");
    return;
  }
  next();
});

hostApp.use(express.static(DIST_DIR));

// API endpoint: configured MCP server URLs
hostApp.get("/api/servers", (_req, res) => {
  res.json(SERVERS);
});

// API endpoint: runtime health/diagnostics for MCP connectivity
hostApp.get("/api/health", (_req, res) => {
  const connectedServers = getConnectedServers();
  const connectedToolCount = connectedServers.reduce(
    (total, server) => total + server.tools.length,
    0
  );

  res.json({
    status:
      connectedServers.length > 0 && connectedToolCount > 0 ? "ok" : "degraded",
    configuredServers: SERVERS,
    connectedServerCount: connectedServers.length,
    connectedToolCount,
    connectedServers: connectedServers.map(server => ({
      name: server.name,
      url: server.url,
      toolCount: server.tools.length,
      tools: server.tools.map(tool => tool.name)
    }))
  });
});

// ---- Conversation management API ----

/** List all conversations (most-recent first). */
hostApp.get("/api/conversations", async (_req, res) => {
  const list = await conversationStore.list();
  res.json(list);
});

/** Get a single conversation with its events. */
hostApp.get("/api/conversations/:id", async (req, res) => {
  const record = await conversationStore.get(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const events = await conversationStore.getEvents(req.params.id);
  res.json({ conversation: record, events });
});

/** Create a new conversation (returns the record). */
hostApp.post("/api/conversations", async (_req, res) => {
  const record = await conversationStore.create();
  resetSession(); // clear any stale in-memory state
  res.status(201).json(record);
});

/** Update a conversation title or metadata. */
hostApp.patch("/api/conversations/:id", async (req, res) => {
  const { title, model, metadata } = req.body ?? {};
  const updates: {
    title?: string;
    model?: string;
    metadata?: Record<string, unknown>;
  } = {};

  if (title === undefined && model === undefined && metadata === undefined) {
    res.status(400).json({ error: "No supported fields provided" });
    return;
  }

  if (title !== undefined && typeof title !== "string") {
    res.status(400).json({ error: "title must be a string" });
    return;
  }
  if (title !== undefined) {
    updates.title = title;
  }

  if (model !== undefined && typeof model !== "string") {
    res.status(400).json({ error: "model must be a string" });
    return;
  }
  if (model !== undefined) {
    updates.model = model;
  }

  if (
    metadata !== undefined &&
    (metadata === null ||
      typeof metadata !== "object" ||
      Array.isArray(metadata))
  ) {
    res.status(400).json({ error: "metadata must be an object" });
    return;
  }
  if (metadata !== undefined) {
    updates.metadata = metadata as Record<string, unknown>;
  }

  const record = await conversationStore.update(req.params.id, updates);

  if (!record) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  res.json(record);
});

/** Delete a conversation. */
hostApp.delete("/api/conversations/:id", async (req, res) => {
  const deleted = await conversationStore.delete(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  resetSession(req.params.id);
  res.status(204).end();
});

// Agent chat endpoint
hostApp.post("/api/chat", (req, res) => {
  handleChat(req, res);
});

hostApp.get("/", (_req, res) => {
  res.redirect("/index.html");
});

// ============ Sandbox Server (port 8081) ============
const sandboxApp = express();
sandboxApp.use(cors());

/**
 * Validate CSP domain entries to prevent injection attacks.
 * Rejects entries containing characters that could break out of CSP directives.
 */
function sanitizeCspDomains(domains?: string[]): string[] {
  if (!domains) return [];
  return domains.filter(d => typeof d === "string" && !/[;\r\n'" ]/.test(d));
}

function buildCspHeader(csp?: McpUiResourceCsp): string {
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains).join(" ");
  const connectDomains = sanitizeCspDomains(csp?.connectDomains).join(" ");
  const frameDomains = sanitizeCspDomains(csp?.frameDomains).join(" ") || null;
  const baseUriDomains =
    sanitizeCspDomains(csp?.baseUriDomains).join(" ") || null;

  const directives = [
    "default-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${resourceDomains}`.trim(),
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    `connect-src 'self' ${connectDomains}`.trim(),
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    "object-src 'none'",
    baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'"
  ];

  return directives.join("; ");
}

// Serve sandbox.html with CSP from query params
sandboxApp.get(["/", "/sandbox.html"], (req, res) => {
  let cspConfig: McpUiResourceCsp | undefined;
  if (typeof req.query.csp === "string") {
    try {
      cspConfig = JSON.parse(req.query.csp);
    } catch (e) {
      console.warn("[Sandbox] Invalid CSP query param:", e);
    }
  }

  const cspHeader = buildCspHeader(cspConfig);
  res.setHeader("Content-Security-Policy", cspHeader);
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  res.sendFile(join(DIST_DIR, "sandbox.html"));
});

sandboxApp.use((_req, res) => {
  res.status(404).send("Only sandbox.html is served on this port");
});

// ============ Start both servers ============
async function start(): Promise<void> {
  await loadSkills();
  await connectToServers(SERVERS);

  // Purge stale conversations on startup
  try {
    const purged = await conversationStore.purgeOlderThan(
      CONVERSATION_MAX_AGE_DAYS
    );
    if (purged > 0) {
      console.log(
        `Purged ${purged} conversation(s) older than ${CONVERSATION_MAX_AGE_DAYS} days`
      );
    }
  } catch (err) {
    console.warn("Conversation purge failed:", err);
  }

  const connectedServers = getConnectedServers();
  const connectedToolCount = connectedServers.reduce(
    (total, server) => total + server.tools.length,
    0
  );

  if (connectedServers.length === 0 || connectedToolCount === 0) {
    throw new Error(
      `No MCP tools connected. Checked servers: ${SERVERS.join(", ")}. ` +
        "Ensure MCP servers are running before starting mcp-app-host."
    );
  }

  hostApp.listen(HOST_PORT, () => {
    console.log(`Host server:     http://localhost:${HOST_PORT}`);
  });

  sandboxApp.listen(SANDBOX_PORT, () => {
    console.log(`Sandbox server:  http://localhost:${SANDBOX_PORT}`);
    console.log(`\nMCP servers:     ${SERVERS.join(", ")}`);
    console.log("\nPress Ctrl+C to stop\n");
  });
}

try {
  await start();
} catch (err) {
  console.error("Failed to start:", err);
  process.exit(1);
}
