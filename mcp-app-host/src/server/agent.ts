/**
 * Agent endpoint: Anthropic Claude tool-use loop with streaming SSE output.
 *
 * - Streams text deltas to the client as they arrive.
 * - Supports multi-turn tool calls (loop until Claude stops requesting tools).
 * - Agent Skills: Claude loads a SKILL.md via read_skill() before using its tools.
 *   Tool schemas are added to the API call progressively as skills are loaded.
 * - Conversations are persisted via the pluggable ConversationStore.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Request, Response } from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChatEvent } from "../shared/chat-events.js";
import { getToolsForNames, executeTool } from "./mcp-client.js";
import { getLocalToolByName, isMetaTool } from "./local-tools.js";
import {
  getSkillSummaries,
  getToolNamesForSkill,
  hasSkill,
  SKILL_TOOL_MAP
} from "./skills-registry.js";
import {
  FileConversationStore,
  type ConversationStore,
  type NewConversationEvent
} from "./conversation-store/index.js";

const MAX_TOOL_TURNS = 10;
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
const MAX_TOKENS = 4096;

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

// ---- Conversation store (swap FileConversationStore for a DB impl later) ----

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONVERSATIONS_DIR = join(__dirname, "..", "..", "conversations");

export const conversationStore: ConversationStore = new FileConversationStore(
  CONVERSATIONS_DIR
);

// ---- Per-session in-memory state keyed by conversationId ----

type SessionState = {
  history: Anthropic.MessageParam[];
  loadedSkills: Set<string>;
};

const sessions = new Map<string, SessionState>();

function getSession(conversationId: string): SessionState {
  let session = sessions.get(conversationId);
  if (!session) {
    session = { history: [], loadedSkills: new Set() };
    sessions.set(conversationId, session);
  }
  return session;
}

/** Build the lean core system prompt — persona and skill-loading instructions only. */
function buildBaseSystemPrompt(): string {
  return `You are a helpful professional AI assistant for NHS postgraduate medical training in the UK.

You have access to Agent Skills. Before using any skill tool, you MUST first call read_skill() with the relevant skill name to load its instructions. Do this once per skill per session.

Golden Rules:
- Route before questioning. If the user message contains strong signals for a skill, load that skill immediately. If the request is vague, ask one short clarification question only about the type of help needed. Do not ask for detailed inputs before the relevant skill is loaded. Do not ask for calculator fields, dates, or percentages from memory when a calculator skill may apply.
- Tools over guessing. Use tools and skills when they are the authoritative source. Do not guess or make up information. If you still don't know after using the available tools, say so.
- Interactive forms are form-first. Some tools open an interactive form UI visible above the chat. When an interactive form tool applies, call it without asking for the form inputs in chat. After calling it, reply only with the required acknowledgement defined by the skill. Do not list form fields or explain the form unless the skill explicitly requires it.
- Be concise. Answer directly and keep clarifying questions short.

Date/time (MANDATORY):
- NEVER assume, estimate, or guess the current date or time — your training data is months or years out of date.
- For ANY question where today's date is relevant: call read_skill("date-tools") first (if not already loaded), then call get_current_datetime.
- For ANY date arithmetic ("in 13 weeks", "3 months after", etc.): call read_skill("date-tools") first (if not already loaded), then call calculate_date_offset.
- Default timezone: Europe/London.

Interactive form tools (MANDATORY):
Some tools open an interactive form UI visible above the chat.
When such a tool applies, call it without asking for the form inputs in chat.
After calling it, reply only with the acknowledgement required by the loaded skill.
Do NOT list form fields or explain the form unless the skill explicitly requires it.`;
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
function getToolsForRequest(loadedSkills: Set<string>): Anthropic.Tool[] {
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
 *
 * Accepts { message, conversationId? } in the body.
 * If conversationId is omitted a new conversation is created.
 * The conversation_id is sent as the first SSE event so the client can
 * track and resume the conversation.
 */
export async function handleChat(req: Request, res: Response): Promise<void> {
  const { message, conversationId: reqConvId } = req.body;

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Missing 'message' field" });
    return;
  }

  // Set up SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Resolve or create the conversation
  let conversationId: string;
  if (typeof reqConvId === "string" && reqConvId.length > 0) {
    const existing = await conversationStore.get(reqConvId);
    conversationId = existing
      ? existing.id
      : (await conversationStore.create()).id;
  } else {
    conversationId = (await conversationStore.create()).id;
  }

  // Tell the client which conversation this belongs to
  sendEvent(res, { type: "conversation_id", conversationId });

  const session = getSession(conversationId);
  session.history.push({ role: "user", content: message });

  // Persist the user message
  const pendingEvents: NewConversationEvent[] = [
    { type: "user_message", role: "user", content: { text: message } }
  ];

  try {
    let toolTurns = 0;

    // Agent loop: keep calling Claude until it stops requesting tools
    while (toolTurns < MAX_TOOL_TURNS) {
      let assistantTextAccumulator = "";

      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        messages: session.history,
        tools: getToolsForRequest(session.loadedSkills)
      });

      // Stream text deltas to the client as they arrive
      stream.on("text", text => {
        assistantTextAccumulator += text;
        sendEvent(res, { type: "text", text });
      });

      const response = await stream.finalMessage();

      // Add the full assistant response to conversation history
      session.history.push({
        role: "assistant",
        content: response.content
      });

      // Check if Claude wants to use tools
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ContentBlock & { type: "tool_use" } =>
          b.type === "tool_use"
      );

      // Persist assistant text (if any meaningful text was streamed)
      if (assistantTextAccumulator.trim().length > 0) {
        pendingEvents.push({
          type: "assistant_message",
          role: "assistant",
          content: { text: assistantTextAccumulator, model: MODEL }
        });
      }

      if (toolUseBlocks.length === 0) {
        // No tool calls — we're done
        break;
      }

      // Execute each tool call and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const meta = isMetaTool(toolUse.name);

        if (meta) {
          // Meta tool (read_skill) — emit a subtle loading indicator
          const skillName = (toolUse.input as Record<string, unknown>)
            .skill_name;
          sendEvent(res, {
            type: "skill_load",
            skillName: typeof skillName === "string" ? skillName : toolUse.name
          });
        } else {
          sendEvent(res, {
            type: "tool_call",
            name: toolUse.name,
            input: toolUse.input as Record<string, unknown>
          });
          pendingEvents.push({
            type: "tool_call",
            role: "assistant",
            content: {
              name: toolUse.name,
              input: toolUse.input as Record<string, unknown>
            }
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
              session.loadedSkills.add(skillName);
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
            pendingEvents.push({
              type: "tool_result",
              role: "assistant",
              content: {
                name: toolUse.name,
                result: resultText,
                hasApp,
                resourceUri,
                isError: false
              }
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
            pendingEvents.push({
              type: "tool_result",
              role: "assistant",
              content: {
                name: toolUse.name,
                result: errMsg,
                hasApp: false,
                isError: true
              }
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
      session.history.push({ role: "user", content: toolResults });
      toolTurns++;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[Agent] Error:", errMsg);
    sendEvent(res, { type: "error", message: errMsg });
  }

  // Flush all accumulated events to the store in one write
  try {
    await conversationStore.appendEvents(conversationId, pendingEvents);
  } catch (err) {
    console.error("[Agent] Failed to persist conversation events:", err);
  }

  sendEvent(res, { type: "done" });
  res.end();
}

/** Reset a specific session (or all sessions if no id given). */
export function resetSession(conversationId?: string): void {
  if (conversationId) {
    sessions.delete(conversationId);
  } else {
    sessions.clear();
  }
}
