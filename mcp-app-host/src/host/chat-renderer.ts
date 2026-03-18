/**
 * Chat renderer: DOM manipulation for messages and MCP App iframes.
 * Framework-free — direct DOM API.
 */

import { marked } from "marked";
import {
  type ToolCallInfo,
  hasAppHtml,
  loadSandboxProxy,
  initializeApp,
  newAppBridge,
  log
} from "./mcp-bridge.js";

const messagesContainer = document.getElementById("messages")!;
const pendingToolRows: HTMLDivElement[] = [];

function createToolStatusRow(): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "tool-status-row";
  messagesContainer.appendChild(row);
  return row;
}

function isValidResizeMessage(event: MessageEvent): boolean {
  return (
    event.data?.type === "app-resize" &&
    typeof event.data.height === "number" &&
    Number.isFinite(event.data.height) &&
    event.data.height > 0
  );
}

function hasCompatibleOrigin(
  iframe: HTMLIFrameElement,
  origin: string
): boolean {
  if (!iframe.src || origin === "null") return true;

  try {
    return new URL(iframe.src).origin === origin;
  } catch {
    return false;
  }
}

function applyIframeHeight(iframe: HTMLIFrameElement, height: number): void {
  iframe.style.height = `${Math.ceil(height + 16)}px`;
  scrollToBottom();
}

// Listen for resize messages from app iframes (relayed through sandbox)
window.addEventListener("message", event => {
  if (!isValidResizeMessage(event)) return;

  const iframes = messagesContainer.querySelectorAll<HTMLIFrameElement>(
    ".app-container iframe"
  );
  for (const iframe of iframes) {
    if (iframe.contentWindow !== event.source) continue;
    if (!hasCompatibleOrigin(iframe, event.origin)) continue;

    applyIframeHeight(iframe, event.data.height);
    break;
  }
});

function scrollToBottom(): void {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/** Add a user message bubble to the chat. */
export function appendUserMessage(text: string): void {
  const el = document.createElement("div");
  el.className = "message user";
  el.textContent = text;
  messagesContainer.appendChild(el);
  scrollToBottom();
}

/** Add an assistant text message bubble. Returns the element for streaming updates. */
export function appendAssistantMessage(text: string = ""): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "message assistant";
  if (text) el.innerHTML = marked.parse(text) as string;
  messagesContainer.appendChild(el);
  scrollToBottom();
  return el;
}

/** Update an existing assistant message element (for streaming). */
export function updateAssistantMessage(el: HTMLDivElement, text: string): void {
  el.innerHTML = marked.parse(text) as string;
  scrollToBottom();
}

/** Add a tool-call indicator bubble. */
export function appendToolCallMessage(toolName: string): void {
  const row = createToolStatusRow();
  const el = document.createElement("div");
  el.className = "message tool-call";
  el.textContent = `🔧 Calling tool: ${toolName}`;
  row.appendChild(el);
  pendingToolRows.push(row);
  scrollToBottom();
}

/** Add a tool-result indicator bubble.
 * @param compact — if true, show only the tick + tool name with no result preview
 *                  (used for text-only tools whose output the agent will present). */
export function appendToolResultMessage(
  toolName: string,
  result: string,
  compact = false
): void {
  const row = pendingToolRows.shift() ?? createToolStatusRow();
  const el = document.createElement("div");
  el.className = "message tool-result";
  if (compact) {
    el.textContent = `✅ ${toolName}`;
  } else {
    el.textContent = `✅ ${toolName}: ${result.length > 200 ? result.slice(0, 200) + "…" : result}`;
  }
  row.appendChild(el);
  scrollToBottom();
}

/** Render an MCP App iframe for a tool call that has UI. */
export async function appendAppIframe(
  toolCallInfo: ToolCallInfo
): Promise<void> {
  if (!hasAppHtml(toolCallInfo)) return;

  const container = document.createElement("div");
  container.className = "app-container";

  const iframe = document.createElement("iframe");
  container.appendChild(iframe);
  messagesContainer.appendChild(container);
  scrollToBottom();

  try {
    // Get CSP and permissions from the resource, then load sandbox
    const { csp, permissions } = await toolCallInfo.appResourcePromise;
    const firstTime = await loadSandboxProxy(iframe, csp, permissions);

    if (firstTime) {
      const appBridge = newAppBridge(toolCallInfo.serverInfo, iframe, {
        onContextUpdate: ctx => log.info("Context update:", ctx),
        onMessage: msg => log.info("App message:", msg)
      });

      await initializeApp(iframe, appBridge, toolCallInfo);
    }
  } catch (err) {
    log.error("Failed to load MCP App:", err);
    container.innerHTML = `<div class="message tool-call">Failed to load app: ${err instanceof Error ? err.message : err}</div>`;
  }
}
