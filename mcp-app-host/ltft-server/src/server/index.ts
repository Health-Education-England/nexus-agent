/**
 * LTFT CCT Calculator — MCP Server with App UI.
 *
 * Exposes:
 *  - Tool: calculate_ltft_cct (model-visible, also callable from the App)
 *  - Resource: ui://ltft/calculator.html (the interactive calculator App)
 *
 * Transport: Streamable HTTP on Express (port 3001, path /mcp).
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { calculate } from "./calculator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const APP_HTML_PATH = path.resolve(
  __dirname,
  "../../dist/app/src/app/calculator.html"
);

// ── MCP Server factory ──────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "LTFT CCT Calculator",
    version: "1.0.0"
  });

  // Register the calculator tool with App UI metadata
  registerAppTool(
    server,
    "calculate_ltft_cct",
    {
      title: "LTFT CCT Calculator",
      description: `Purpose: Open the LTFT calculator UI and, when submitted from the form, calculate a new CCT date for a doctor changing working pattern.

Use this tool when:
- The user explicitly asks to calculate a new CCT date
- The user asks to open or use the LTFT calculator
- The user wants to compare LTFT working patterns or see the date impact of a change

Do not use this tool when:
- The user is asking for general information about LTFT policy, eligibility, process, or rules
- The user only says "ltft" or gives another brief ambiguous follow-up
- The user has not yet made clear that they want a calculation

Interaction model:
- On the first call, this tool usually opens an interactive form UI
- Pass any known values to prefill the form and omit unknown values
- The user completes the visible form themselves

Input rules:
- All dates must be YYYY-MM-DD
- All percentages must be decimals between 0 and 1, for example 80% = 0.8
- Standard LTFT percentages are 50%, 60%, 70%, 80%, and 100% for return to full-time`,
      inputSchema: {
        programme_name: z
          .string()
          .optional()
          .describe("Name of the training programme (optional)."),
        current_cct_date: z
          .string()
          .optional()
          .describe("Current CCT date in YYYY-MM-DD format."),
        current_work_percentage: z
          .number()
          .optional()
          .describe("Current WTE as a decimal between 0 and 1."),
        proposed_work_percentage: z
          .number()
          .optional()
          .describe("Proposed WTE as a decimal between 0 and 1."),
        proposed_start_date: z
          .string()
          .optional()
          .describe("Date the proposed LTFT change starts, YYYY-MM-DD."),
        _submitted_from_form: z
          .boolean()
          .optional()
          .describe(
            "Internal app flag. If true, run calculation using submitted form values."
          )
      },
      _meta: {
        ui: { resourceUri: "ui://ltft/calculator.html" }
      }
    },
    async args => {
      // Form-first policy:
      // - Agent/model calls should only open/prepopulate the form.
      // - Only explicit in-form submission performs the calculation.
      if (args._submitted_from_form !== true) {
        return {
          content: [
            {
              type: "text",
              text: "✅ Display LTFT CCT calculator form."
            }
          ]
        };
      }

      // For form submissions, require complete inputs before calculation.
      const required = [
        "current_cct_date",
        "current_work_percentage",
        "proposed_work_percentage",
        "proposed_start_date"
      ] as const;
      const missing = required.filter(k => args[k] == null || args[k] === "");
      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Missing required fields for calculation: ${missing.join(", ")}.`
            }
          ],
          isError: true
        };
      }

      try {
        const result = calculate({
          programme_name: args.programme_name,
          current_cct_date: args.current_cct_date as string,
          current_work_percentage: args.current_work_percentage as number,
          proposed_work_percentage: args.proposed_work_percentage as number,
          proposed_start_date: args.proposed_start_date as string
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${msg}` }],
          isError: true
        };
      }
    }
  );

  // Register the HTML resource that the tool's UI points to
  registerAppResource(
    server,
    "LTFT Calculator",
    "ui://ltft/calculator.html",
    { description: "Interactive LTFT CCT date calculator" },
    async () => ({
      contents: [
        {
          uri: "ui://ltft/calculator.html",
          mimeType: RESOURCE_MIME_TYPE,
          text: await readFile(APP_HTML_PATH, "utf-8")
        }
      ]
    })
  );

  return server;
}

// ── Express + Streamable HTTP Transport ─────────────────────────────

const app = express();

// CORS is required because the browser-side MCP client (host on port 8080)
// connects directly to this server (port 3001) for App resource fetching.
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
  // Reuse existing transport for the same session
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res, req.body);
    return;
  }

  // Only POST can create a new session (initialize handshake).
  // GET (SSE) and DELETE without a valid session are rejected.
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

  // New session — create a new transport and server instance
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

  // Store after handleRequest — that's when the session ID is assigned
  if (transport.sessionId) {
    transports.set(transport.sessionId, transport);
  }
});

app.listen(PORT, () => {
  console.log(`[LTFT MCP Server] listening on http://localhost:${PORT}/mcp`);
});
