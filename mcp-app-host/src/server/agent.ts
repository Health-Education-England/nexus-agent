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

const DEFAULT_PRE_TOOL_SENTENCE =
  "I'll check that now using the available tool.";

const PRE_TOOL_SENTENCE_BY_TOOL: Record<string, string> = {
  ask_gold_guide: "I'll check the Gold Guide and pull the exact references.",
  calculate_ltft_cct: "I'll run the LTFT CCT calculator now.",
  get_current_datetime: "I'll get the current date and time now.",
  calculate_date_offset: "I'll calculate that date offset now."
};

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

function getPreToolSentence(toolName: string): string {
  return PRE_TOOL_SENTENCE_BY_TOOL[toolName] ?? DEFAULT_PRE_TOOL_SENTENCE;
}

function buildBaseSystemPrompt(): string {
  return `You are a helpful professional AI assistant for NHS postgraduate medical training in the UK.
You have access to tools provided by connected MCP servers.
Answer the user's questions directly. When a tool would help, use it. Do not guess or make stuff up. Use the tools and if you still don't know, say you don't know. Always be concise and clear.

Date/time guidance:
- Never assume the current date or time.
- When date/time is relevant, always call get_current_datetime.
- For date arithmetic (e.g., "in 13 weeks", "10 days after", "3 months before"), always call calculate_date_offset.
- Default to Europe/London timezone unless the user specifies another timezone.

Conversation flow guidance (MANDATORY):
- If you are about to call any tool, first send one short sentence explaining what you will do.
- After tool results return, provide the final answer/explanation in a follow-up response.
- Do not stop at a pre-tool sentence; always finish with the post-tool answer.

Your primary tools:
- Gold Guide policy questions (training rules, ARCP, LTFT policy, OOP, etc.) → use ask_gold_guide
- LTFT CCT date calculations (less than full-time training) → use calculate_ltft_cct
- Current date/time lookup → use get_current_datetime
- Date arithmetic and offsets → use calculate_date_offset

Tool selection guidance:
- For Gold Guide policy questions, always use the ask_gold_guide tool first.

Intent routing for LTFT:
- Distinguish carefully between:
  1. LTFT as a policy/topic question
  2. LTFT as a request to calculate a new CCT date or open the calculator
- If the user wants information about LTFT, eligibility, process, categories, implications, or policy, use ask_gold_guide.
- Only call calculate_ltft_cct when the user explicitly wants to calculate a CCT date, work out the impact of a working-pattern change, compare percentages, or asks you to open/use the calculator.
- If the user message is brief or ambiguous, for example "ltft", "oop", "arcp", or another single-topic follow-up, do NOT jump straight to a tool. Ask one short clarifying question that offers the most likely next options.
- For an ambiguous LTFT follow-up, prefer wording like: "Would you like general information about LTFT, or would you like to calculate a new CCT date?"
- If the user provides some LTFT calculator inputs but has not explicitly asked for a calculation yet, first confirm they want to calculate unless their intent is obvious.

Calculator UI guidance:
- The calculate_ltft_cct tool has an interactive form UI and can be used to open the calculator with any known values prefilled.
- When you call calculate_ltft_cct to open the form, pass any values already known and omit unknown values.
- Do not call calculate_ltft_cct merely because LTFT was mentioned.

Citation rules (MANDATORY when using ask_gold_guide):
- The ask_gold_guide tool returns an answer with inline citation IDs (e.g. 3.123, 3.126 ii) and a CITATIONS block. You MUST preserve these citation IDs inline in your response text wherever the underlying fact is stated.
- Format citations as parenthetical references, e.g. "All trainees can apply for LTFT training (3.123)."
- Never strip, paraphrase, or omit citation IDs. If the tool provided a citation for a fact, your response must include it.
- If the tool returns a CITATIONS block, include a brief "References" section at the end of your response listing the cited paragraph numbers.
- Always end the references section with: "All references are from the Gold Guide 10th Edition (August 2024): https://www.copmed.org.uk/images/docs/goldguide10thedition/Gold%20Guide%2010th%20Edition%20August%202024.pdf"

CROSS-TOOL AWARENESS:
When ask_gold_guide returns an answer that relates to LTFT or less than full-time training, and you have not yet called calculate_ltft_cct, always end your response with a single short sentence offering the calculator e.g.:
"If you'd like to calculate your new CCT date, just ask and I'll open the calculator for you."
Do NOT add this offer for unrelated policy topics.

IMPORTANT — Interactive App UIs:
Some tools have an associated interactive UI (a form/app) that is displayed to the user when you call the tool.
If the user has included any values in the conversation before you call the tool, those values will be passed as input to the form and can be used to pre-fill form fields, saving the user time, so:
1. Pass whatever values you already know. Omit fields you do not know or are unsure about.
2. After displaying a form, your response must be ONE sentence only and it must acknowledge that the form is already visible, e.g. "The LTFT CCT calculator is open above — fill in your details and hit Calculate." Do NOT say "I'll open" or "I've opened". Do NOT list fields, do NOT explain what the form does, do NOT use bullet points.
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
      let sawTextThisTurn = false;

      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        messages: conversationHistory,
        tools: getToolsForRequest()
      });

      // Stream text deltas to the client as they arrive
      stream.on("text", text => {
        if (text.trim().length > 0) sawTextThisTurn = true;
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
      let sentFallbackPreToolText = false;

      for (const toolUse of toolUseBlocks) {
        if (!sawTextThisTurn && !sentFallbackPreToolText) {
          sendEvent(res, {
            type: "text",
            text: getPreToolSentence(toolUse.name)
          });
          sentFallbackPreToolText = true;
        }

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
