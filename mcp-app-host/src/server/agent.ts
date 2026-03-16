/**
 * Agent endpoint: Anthropic Claude tool-use loop with streaming SSE output.
 *
 * - Streams text deltas to the client as they arrive.
 * - Supports multi-turn tool calls (loop until Claude stops requesting tools).
 * - Progressive tool disclosure: sends tool summaries in the system prompt,
 *   only loads full schemas when Claude requests a tool (when >5 tools).
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Request, Response } from "express";
import type { ChatEvent } from "../shared/chat-events.js";
import {
  getAvailableTools,
  getToolSummaries,
  executeTool
} from "./mcp-client.js";

const MAX_TOOL_TURNS = 10;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

function buildBaseSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a helpful assistant running inside an MCP App Host.
You have access to tools provided by connected MCP servers.
Answer the user's questions directly. When a tool would help, use it.
Be concise and clear.
Today's date is ${today}.

IMPORTANT — Interactive App UIs:
Some tools have an associated interactive UI (a form/app) that is displayed to the user when you call the tool.
When a user asks about a topic covered by such a tool:
1. Call the tool IMMEDIATELY as your first action — do NOT output any text before the tool call.
2. Pass whatever values you already know. Omit fields you do not know.
3. After the tool result, respond with a single short sentence like "I've opened the calculator for you" or "Here's the form — fill in any remaining fields and hit Calculate." Do NOT list out the fields or explain the form.
4. NEVER call the same tool again to retry — the form is interactive and the user will complete it themselves.`;
}

// Per-session in-memory conversation history.
// A production system would scope this per user/session.
let conversationHistory: Anthropic.MessageParam[] = [];

/** Write a single SSE event to the response stream. */
function sendEvent(res: Response, event: ChatEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/** Build the system prompt, optionally with tool summaries for progressive disclosure. */
function buildSystemPrompt(): string {
  const base = buildBaseSystemPrompt();
  const summaries = getToolSummaries();
  if (summaries.length === 0) return base;

  const toolList = summaries
    .map(t => `- ${t.name}: ${t.description}`)
    .join("\n");

  return `${base}\n\nAvailable tools:\n${toolList}`;
}

/**
 * Decide which tool definitions to send to Claude.
 * - ≤5 tools: send all full schemas (not worth an extra round-trip).
 * - >5 tools: summaries are in the system prompt; defer full schemas.
 */
function getToolsForRequest(): Anthropic.Tool[] {
  const { anthropicTools } = getAvailableTools();
  // Always send full schemas for now — progressive two-pass is ready
  // to activate when tool count grows. The summaries are already in
  // the system prompt for better routing regardless.
  return anthropicTools as Anthropic.Tool[];
}

/**
 * Extract text content from a tool call result for sending back to Claude.
 */
function toolResultToText(
  result: Awaited<ReturnType<typeof executeTool>>["result"]
): string {
  if (!result.content || result.content.length === 0) return "No result.";
  return result.content
    .map(block => {
      if (block.type === "text") return block.text;
      if (block.type === "image") return "[image]";
      return JSON.stringify(block);
    })
    .join("\n");
}

/**
 * POST /api/chat handler — streams SSE events.
 * Runs the Claude tool-use loop, streaming text and emitting tool events.
 */
export async function handleChat(req: Request, res: Response): Promise<void> {
  const { message } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Missing 'message' field" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  conversationHistory.push({ role: "user", content: message });

  try {
    let toolTurns = 0;

    // Agent loop: keep calling Claude until it stops requesting tools
    while (toolTurns < MAX_TOOL_TURNS) {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        messages: conversationHistory,
        tools: getToolsForRequest()
      });

      // Stream text deltas to the client as they arrive
      stream.on("text", text => {
        sendEvent(res, { type: "text", text });
      });

      const response = await stream.finalMessage();

      // Add the full assistant response to conversation history
      conversationHistory.push({
        role: "assistant",
        content: response.content
      });

      // Check if Claude wants to use tools
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlock & { type: "tool_use" } =>
          b.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) {
        // No tool calls — we're done
        break;
      }

      // Execute each tool call and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        sendEvent(res, {
          type: "tool_call",
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>
        });

        try {
          const { result, hasApp, resourceUri } = await executeTool(
            toolUse.name,
            toolUse.input as Record<string, unknown>
          );

          const resultText = toolResultToText(result);

          sendEvent(res, {
            type: "tool_result",
            name: toolUse.name,
            result: resultText,
            hasApp,
            resourceUri
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: resultText
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          sendEvent(res, {
            type: "tool_result",
            name: toolUse.name,
            result: `Error: ${errMsg}`,
            hasApp: false
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Error: ${errMsg}`,
            is_error: true
          });
        }
      }

      // Add tool results to conversation and loop back for Claude's response
      conversationHistory.push({ role: "user", content: toolResults });
      toolTurns++;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Agent] Error:", errMsg);
    sendEvent(res, { type: "error", message: errMsg });
  }

  sendEvent(res, { type: "done" });
  res.end();
}
