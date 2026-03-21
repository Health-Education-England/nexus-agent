/**
 * Chat renderer: DOM manipulation for messages and MCP App iframes.
 * Framework-free — direct DOM API.
 */

import { marked } from "marked";
import {
  type ToolCallInfo,
  hasAppHtml,
  getToolUiResourceUri,
  readUiResource,
  loadSandboxProxy,
  initializeApp,
  newAppBridge,
  log
} from "./mcp-bridge.js";

const messagesContainer = document.getElementById("messages")!;
const pendingToolRows: HTMLDivElement[] = [];

/** Persistent skill-loading chip (replaced/removed on skill_ready). */
let skillLoadingChip: HTMLDivElement | null = null;
let skillLoadingShownAt = 0;
let pendingHideSkillChipTimeout: number | null = null;
const SKILL_LOADING_MIN_VISIBLE_MS = 1000;
let responseSynthesisChip: HTMLDivElement | null = null;
const MAX_APP_RENDER_RETRIES = 3;

function removeSkillLoadingChip(): void {
  skillLoadingChip?.remove();
  skillLoadingChip = null;
  skillLoadingShownAt = 0;
  if (pendingHideSkillChipTimeout !== null) {
    globalThis.clearTimeout(pendingHideSkillChipTimeout);
    pendingHideSkillChipTimeout = null;
  }
}

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

/** Clear the chat transcript and reset transient renderer state. */
export function clearMessages(): void {
  pendingToolRows.length = 0;
  removeSkillLoadingChip();
  hideResponseSynthesisIndicator();
  messagesContainer.innerHTML = "";
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
  let retryCount = 0;

  const container = document.createElement("div");
  container.className = "app-container";

  messagesContainer.appendChild(container);
  scrollToBottom();

  const renderAttempt = async (): Promise<void> => {
    const uiResourceUri = getToolUiResourceUri(toolCallInfo.tool);
    if (!uiResourceUri) return;

    const retryableToolCallInfo = {
      ...toolCallInfo,
      appResourcePromise: readUiResource(toolCallInfo.serverInfo, uiResourceUri)
    };

    container.innerHTML = "";
    const iframe = document.createElement("iframe");
    container.appendChild(iframe);

    // Get CSP and permissions from the resource, then load sandbox
    const { csp, permissions } = await retryableToolCallInfo.appResourcePromise;
    const firstTime = await loadSandboxProxy(iframe, csp, permissions);

    if (firstTime) {
      const appBridge = newAppBridge(toolCallInfo.serverInfo, iframe, {
        onContextUpdate: ctx => log.info("Context update:", ctx),
        onMessage: msg => log.info("App message:", msg)
      });

      await initializeApp(iframe, appBridge, retryableToolCallInfo);
    }
  };

  const showRetryFallback = (err: unknown): void => {
    log.error("Failed to load MCP App:", err);
    container.innerHTML = "";
    const canRetryInPlace = retryCount < MAX_APP_RENDER_RETRIES;

    const fallback = document.createElement("div");
    fallback.className = "message tool-call";

    const message = document.createElement("span");
    message.textContent = canRetryInPlace
      ? "Hmm, having trouble displaying this app for you. Please click Try again."
      : "Hmm, this app still isn’t loading after multiple attempts. Please refresh the page and try again.";
    fallback.appendChild(message);

    const action = document.createElement("button");
    action.type = "button";
    action.textContent = canRetryInPlace ? "Try again" : "Refresh page";
    action.style.marginLeft = "0.6rem";
    action.addEventListener("click", () => {
      action.disabled = true;
      if (canRetryInPlace) {
        retryCount += 1;
        action.textContent = "Retrying…";
        void renderAttempt().catch(retryErr => {
          showRetryFallback(retryErr);
        });
        return;
      }

      action.textContent = "Refreshing…";
      window.location.reload();
    });
    fallback.appendChild(action);

    container.appendChild(fallback);
  };

  try {
    await renderAttempt();
  } catch (err) {
    showRetryFallback(err);
  }
}

/**
 * Show a subtle inline chip indicating that an Agent Skill is being loaded.
 * Replaces any existing chip (only one skill loads at a time).
 */
export function showSkillLoadingIndicator(skillName: string): void {
  removeSkillLoadingChip();
  const chip = document.createElement("div");
  chip.className = "skill-loading-chip";
  chip.textContent = `Loading skill: ${skillName}…`;
  messagesContainer.appendChild(chip);
  skillLoadingChip = chip;
  skillLoadingShownAt = Date.now();
  scrollToBottom();
}

/** Remove the skill-loading chip (called on skill_ready). */
export function hideSkillLoadingIndicator(): void {
  if (!skillLoadingChip) return;

  const elapsed = Date.now() - skillLoadingShownAt;
  const remaining = SKILL_LOADING_MIN_VISIBLE_MS - elapsed;

  if (remaining <= 0) {
    removeSkillLoadingChip();
    return;
  }

  if (pendingHideSkillChipTimeout !== null) {
    globalThis.clearTimeout(pendingHideSkillChipTimeout);
  }
  pendingHideSkillChipTimeout = window.setTimeout(() => {
    removeSkillLoadingChip();
  }, remaining);
}

/** Show a subtle chip while the assistant is composing a post-tool response. */
export function showResponseSynthesisIndicator(): void {
  hideResponseSynthesisIndicator();
  const chip = document.createElement("div");
  chip.className = "response-synthesis-chip";
  chip.textContent = "Preparing response…";
  messagesContainer.appendChild(chip);
  responseSynthesisChip = chip;
  scrollToBottom();
}

/** Hide the post-tool response synthesis chip. */
export function hideResponseSynthesisIndicator(): void {
  responseSynthesisChip?.remove();
  responseSynthesisChip = null;
}
