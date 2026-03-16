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
import { handleChat } from "./agent.js";
import { connectToServers, getConnectedServers } from "./mcp-client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOST_PORT = Number.parseInt(process.env.HOST_PORT || "8080", 10);
const SANDBOX_PORT = Number.parseInt(process.env.SANDBOX_PORT || "8081", 10);
const DIST_DIR = join(__dirname, "..", "..", "dist");
const SERVERS: string[] = process.env.SERVERS
  ? JSON.parse(process.env.SERVERS)
  : ["http://localhost:3001/mcp"];

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
  await connectToServers(SERVERS);

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
