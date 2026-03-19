/**
 * Chat UI entry point.
 * Handles user input and streams responses from /api/chat via SSE.
 * Connects to MCP servers browser-side for App iframe rendering.
 * Tracks the active conversationId so messages belong to one thread.
 */

import type { ChatEvent, ToolCallEvent } from "../shared/chat-events.js";
import {
  appendUserMessage,
  appendAssistantMessage,
  updateAssistantMessage,
  appendToolCallMessage,
  appendToolResultMessage,
  appendAppIframe,
  showSkillLoadingIndicator,
  hideSkillLoadingIndicator,
  showResponseSynthesisIndicator,
  hideResponseSynthesisIndicator
} from "./chat-renderer.js";
import {
  type ServerInfo,
  type ToolCallInfo,
  connectToServer,
  log
} from "./mcp-bridge.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";

const form = document.getElementById("chat-form") as HTMLFormElement;
const input = document.getElementById("chat-input") as HTMLInputElement;
const sendBtn = form.querySelector("button") as HTMLButtonElement;

// Browser-side MCP client connections (for App iframe rendering)
const toolServerMap = new Map<string, ServerInfo>();

// Active conversation ID — set by the server on first message, reused for the session.
let currentConversationId: string | null = null;

/** Connect browser-side to all MCP servers for App resource access. */
async function initMcpConnections(): Promise<void> {
  try {
    const res = await fetch("/api/servers");
    const urls: string[] = await res.json();
    log.info("MCP server URLs:", urls);
    for (const url of urls) {
      try {
        const info = await connectToServer(new URL(url));
        for (const [name] of info.tools) {
          toolServerMap.set(name, info);
        }
        log.info(
          `Connected to ${info.name}, tools: ${Array.from(info.tools.keys()).join(", ")}`
        );
      } catch (err) {
        log.error("Failed to connect browser to MCP server:", url, err);
      }
    }
  } catch (err) {
    log.error("Failed to fetch server list:", err);
  }
}

/** Build a ToolCallInfo for App iframe rendering without re-calling the tool. */
function buildToolCallInfo(
  toolName: string,
  toolInput: Record<string, unknown>,
  resultText: string
): ToolCallInfo | null {
  const server = toolServerMap.get(toolName);
  if (!server) {
    log.warn(
      `Cannot render App for tool "${toolName}": no browser-side MCP connection.`,
      "Available tools:",
      Array.from(toolServerMap.keys())
    );
    return null;
  }

  const tool = server.tools.get(toolName);
  if (!tool) return null;

  const resourceUri = getToolUiResourceUri(tool);
  if (!resourceUri) return null;

  // Construct a resolved CallToolResult from the SSE result text
  const callToolResult: CallToolResult = {
    content: [{ type: "text", text: resultText }]
  };

  const info: ToolCallInfo = {
    serverInfo: server,
    tool,
    input: toolInput,
    resultPromise: Promise.resolve(callToolResult)
  };

  // Fetch the UI resource for the iframe
  info.appResourcePromise = (async () => {
    const resource = await server.client.readResource({ uri: resourceUri });
    const content = resource.contents[0];
    const html = "blob" in content ? atob(content.blob) : (content.text ?? "");
    return { html };
  })();

  return info;
}

function setInputEnabled(enabled: boolean): void {
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
  if (enabled) input.focus();
}

/**
 * Parse SSE lines from a text chunk.
 * Each event is `data: <json>\n\n`.
 * Handles partial lines that may span chunks via the buffer.
 */
function parseSSEEvents(
  chunk: string,
  buffer: string
): { events: ChatEvent[]; remaining: string } {
  const combined = buffer + chunk;
  const events: ChatEvent[] = [];
  const lines = combined.split("\n");

  // Last element may be an incomplete line
  const remaining = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed?.startsWith("data: ")) continue;
    try {
      events.push(JSON.parse(trimmed.slice(6)));
    } catch {
      // Skip malformed lines
    }
  }

  return { events, remaining };
}

async function sendMessage(text: string): Promise<void> {
  setInputEnabled(false);
  appendUserMessage(text);

  // Create the assistant bubble immediately so the CSS "Thinking…" placeholder
  // shows during the skill-load round-trip and any other server-side delay.
  let currentAssistantEl: HTMLDivElement | null = appendAssistantMessage("");
  let currentAssistantText = "";
  let hasAnyAssistantText = false;

  const ensureAssistantBubble = (): HTMLDivElement => {
    if (!currentAssistantEl) {
      currentAssistantEl = appendAssistantMessage("");
      currentAssistantText = "";
    }
    return currentAssistantEl;
  };

  const appendAssistantDelta = (delta: string): void => {
    if (!delta) return;
    const bubble = ensureAssistantBubble();
    currentAssistantText += delta;
    hasAnyAssistantText = hasAnyAssistantText || delta.trim().length > 0;
    updateAssistantMessage(bubble, currentAssistantText);
  };

  const startNewAssistantBubble = (): void => {
    if (currentAssistantEl && currentAssistantText.trim().length === 0) {
      currentAssistantEl.remove();
    }
    currentAssistantEl = null;
    currentAssistantText = "";
  };

  const setAssistantMessage = (message: string): void => {
    const bubble = ensureAssistantBubble();
    currentAssistantText = message;
    hasAnyAssistantText = hasAnyAssistantText || message.trim().length > 0;
    updateAssistantMessage(bubble, message);
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        conversationId: currentConversationId
      })
    });

    if (!res.ok) {
      setAssistantMessage(`Error: ${res.status} ${res.statusText}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      setAssistantMessage("Error: No response stream");
      return;
    }

    const decoder = new TextDecoder();
    let sseBuffer = "";
    // Track pending tool calls so we can pair them with results
    const pendingToolCalls = new Map<string, ToolCallEvent>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const { events, remaining } = parseSSEEvents(chunk, sseBuffer);
      sseBuffer = remaining;

      for (const event of events) {
        switch (event.type) {
          case "conversation_id":
            currentConversationId = event.conversationId;
            break;
          case "text":
            hideResponseSynthesisIndicator();
            appendAssistantDelta(event.text);
            break;
          case "tool_call":
            hideResponseSynthesisIndicator();
            appendToolCallMessage(event.name);
            pendingToolCalls.set(event.name, event);
            // Any assistant text after tool activity should appear
            // in a fresh bubble below the tool status pills.
            startNewAssistantBubble();
            break;
          case "tool_result": {
            // compact = no result preview for text-only tools (agent presents the answer)
            appendToolResultMessage(event.name, event.result, !event.hasApp);
            // Render MCP App iframe if the tool has a UI
            if (event.hasApp) {
              const pending = pendingToolCalls.get(event.name);
              const toolInput = pending?.input ?? {};
              const toolCallInfo = buildToolCallInfo(
                event.name,
                toolInput,
                event.result
              );
              if (toolCallInfo) {
                appendAppIframe(toolCallInfo).catch(err =>
                  log.error("Failed to render App iframe:", err)
                );
              }
            }
            pendingToolCalls.delete(event.name);
            showResponseSynthesisIndicator();
            break;
          }
          case "error":
            hideResponseSynthesisIndicator();
            hideSkillLoadingIndicator();
            setAssistantMessage(`Error: ${event.message}`);
            break;
          case "skill_load":
            hideResponseSynthesisIndicator();
            // A skill-load is a turn boundary: any text that follows comes
            // from a new Claude turn, so it should appear in a fresh bubble.
            startNewAssistantBubble();
            showSkillLoadingIndicator(event.skillName);
            break;
          case "skill_ready":
            hideSkillLoadingIndicator();
            break;
          case "done":
            hideResponseSynthesisIndicator();
            hideSkillLoadingIndicator();
            break;
        }
      }
    }

    // If no text was received, show a fallback
    if (!hasAnyAssistantText) {
      setAssistantMessage("No response received.");
    }
  } catch (err) {
    setAssistantMessage(
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    setInputEnabled(true);
  }
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await sendMessage(text);
});

// Initialize: connect browser-side MCP clients, then enable input
initMcpConnections().then(() => {
  log.info("Browser MCP connections ready");
  input.focus();
});
