/**
 * Agent endpoint: Anthropic Claude tool-use loop with streaming SSE output.
 *
 * - Streams text deltas to the client as they arrive.
 * - Supports multi-turn tool calls (loop until Claude stops requesting tools).
 * - Agent Skills: Claude loads a SKILL.md via read_skill() before using its tools.
 *   Tool schemas are added to the API call progressively as skills are loaded.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Request, Response } from "express";
import type { ChatEvent } from "../shared/chat-events.js";
import { getToolsForNames, executeTool } from "./mcp-client.js";
import { getLocalToolByName, isMetaTool } from "./local-tools.js";
import {
  getSkillSummaries,
  getToolNamesForSkill,
  hasSkill,
  SKILL_TOOL_MAP
} from "./skills-registry.js";

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

/** Build the lean core system prompt — persona and skill-loading instructions only. */
function buildBaseSystemPrompt(): string {
  return `You are a helpful professional AI assistant for NHS postgraduate medical training in the UK.

You have access to Agent Skills — organised sets of tools and instructions. Before using any tool, you MUST first call read_skill() with the relevant skill name to load its instructions. Do this once per skill per session.

Answer the user's questions directly. When a tool would help, use it. Do not guess or make up information. If you still don't know after using tools, say so. Always be concise and clear.

Date/time (MANDATORY):
- NEVER assume, estimate, or guess the current date or time — your training data is months or years out of date.
- For ANY question where today's date is relevant: call read_skill("date-tools") first (if not already loaded), then call get_current_datetime.
- For ANY date arithmetic ("in 13 weeks", "3 months after", etc.): call read_skill("date-tools") first (if not already loaded), then call calculate_date_offset.
- Default timezone: Europe/London.

Conversation flow (MANDATORY):
- If you are about to call any domain tool (not read_skill), first send one short sentence explaining what you will do.
- After tool results return, provide the final answer in a follow-up response.
- Do not stop at a pre-tool sentence; always finish with the post-tool answer.

Interactive form tools (MANDATORY):
Some tools open an interactive form UI (visible to the user above the chat). After calling any such tool, your entire response MUST be exactly ONE short sentence acknowledging the form is open — for example: "The LTFT CCT calculator is open above — fill in your details and hit Calculate."
Do NOT list form fields, explain what the form does, or use bullet points. The form is self-explanatory. NEVER call the same tool again.`;
}

/** Build the full system prompt: core persona + skills catalog. */
function buildSystemPrompt(): string {
  const base = buildBaseSystemPrompt();
  const summaries = getSkillSummaries();
  if (summaries.length === 0) return base;

  const catalog = summaries
    .map(s => {
      const tools = SKILL_TOOL_MAP[s.name] ?? [];
      const toolList = tools.length > 0 ? ` (tools: ${tools.join(", ")})` : "";
      return `- **${s.name}**${toolList}: ${s.description}`;
    })
    .join("\n");

  return `${base}

## Available Skills

${catalog}

Call read_skill("<skill-name>") to load a skill before using any of its tools.`;
}

// Per-session in-memory conversation history.
// A production system would scope this per user/session.
let conversationHistory: Anthropic.MessageParam[] = [];

/** Tracks which skills have been loaded in the current session. */
let loadedSkills: Set<string> = new Set();

/** Write a single SSE event to the response stream. */
function sendEvent(res: Response, event: ChatEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Build the tool list for the current API call.
 *
 * Always-on:
 *   - read_skill (meta tool, always present so Claude can load skills)
 *
 * Loaded on demand (added once the skill has been read via read_skill):
 *   - date-tools tools: get_current_datetime, calculate_date_offset
 *   - gold-guide tools: ask_gold_guide
 *   - ltft-calculator tools: calculate_ltft_cct
 */
function getToolsForRequest(): Anthropic.Tool[] {
  // Always include read_skill
  const readSkillTool = getLocalToolByName("read_skill")!;
  const alwaysOn: Anthropic.Tool[] = [
    {
      name: readSkillTool.name,
      description: readSkillTool.description,
      input_schema: readSkillTool.inputSchema as Anthropic.Tool["input_schema"]
    }
  ];

  // Add schemas for tools belonging to each already-loaded skill
  const sortedLoadedSkills = Array.from(loadedSkills).sort((a, b) =>
    a.localeCompare(b)
  );
  const skillToolNames = Array.from(
    new Set(
      sortedLoadedSkills.flatMap(skillName => getToolNamesForSkill(skillName))
    )
  ).sort((a, b) => a.localeCompare(b));

  const skillTools = getToolsForNames(skillToolNames).map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool["input_schema"]
  }));

  return [...alwaysOn, ...skillTools];
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
        const meta = isMetaTool(toolUse.name);

        if (!meta) {
          // Domain tool — show pre-tool sentence if Claude didn't already say one
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
        } else {
          // Meta tool (read_skill) — emit a subtle loading indicator
          const skillName = (toolUse.input as Record<string, unknown>)
            .skill_name;
          sendEvent(res, {
            type: "skill_load",
            skillName: typeof skillName === "string" ? skillName : toolUse.name
          });
        }

        try {
          let result: Awaited<ReturnType<typeof executeTool>>["result"];
          let hasApp = false;
          let resourceUri: string | undefined;

          const localTool = getLocalToolByName(toolUse.name);
          if (localTool) {
            result = await localTool.execute(
              toolUse.input as Record<string, unknown>
            );
          } else {
            const execResult = await executeTool(
              toolUse.name,
              toolUse.input as Record<string, unknown>
            );
            result = execResult.result;
            hasApp = execResult.hasApp;
            resourceUri = execResult.resourceUri;
          }

          const resultText = toolResultToText(result);

          if (meta) {
            // Register the skill so its tools appear in subsequent API calls
            const skillName = (toolUse.input as Record<string, unknown>)
              .skill_name;
            if (typeof skillName === "string" && hasSkill(skillName)) {
              loadedSkills.add(skillName);
            }
            sendEvent(res, {
              type: "skill_ready",
              skillName:
                typeof skillName === "string" ? skillName : toolUse.name
            });
          } else {
            sendEvent(res, {
              type: "tool_result",
              name: toolUse.name,
              result: resultText,
              hasApp,
              resourceUri
            });
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: resultText
          });
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);

          if (meta) {
            const skillName = (toolUse.input as Record<string, unknown>)
              .skill_name;
            sendEvent(res, {
              type: "skill_ready",
              skillName:
                typeof skillName === "string" ? skillName : toolUse.name
            });
          } else {
            sendEvent(res, {
              type: "tool_result",
              name: toolUse.name,
              result: `Error: ${errMsg}`,
              hasApp: false
            });
          }

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

/** Reset the in-memory session (conversation history + loaded skills). */
export function resetSession(): void {
  conversationHistory = [];
  loadedSkills = new Set();
}
