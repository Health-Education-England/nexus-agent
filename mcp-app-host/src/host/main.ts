/**
 * Chat UI entry point.
 * Handles conversation list CRUD, transcript rendering, and SSE chat streaming.
 */

import type { ChatEvent, ToolCallEvent } from "../shared/chat-events.js";
import type {
  ConversationEvent,
  ConversationSummary
} from "../server/conversation-store/index.js";
import {
  appendUserMessage,
  appendAssistantMessage,
  updateAssistantMessage,
  appendToolCallMessage,
  appendToolResultMessage,
  appendAppIframe,
  clearMessages,
  showSkillLoadingIndicator,
  hideSkillLoadingIndicator,
  showResponseSynthesisIndicator,
  hideResponseSynthesisIndicator
} from "./chat-renderer.js";
import {
  type ServerInfo,
  type ToolCallInfo,
  connectToServer,
  readUiResource,
  log
} from "./mcp-bridge.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getToolUiResourceUri } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  DEFAULT_CONVERSATION_TITLE,
  deriveConversationTitle
} from "../shared/conversation-title.js";
import {
  createConversationRecord,
  deleteConversationRecord,
  getConversation,
  listConversations,
  renameConversationRecord
} from "./conversation-api.js";
import { renderConversationListView } from "./conversation-list-view.js";

type PendingDelete = {
  title: string;
  timer: number;
};

const SOFT_DELETE_WINDOW_MS = 10000;
const WELCOME_MESSAGE =
  "Hello! Start a new conversation or reopen a saved one from the sidebar.";
const EMPTY_CONVERSATION_MESSAGE =
  "This conversation is empty. Ask anything to begin.";

const form = document.getElementById("chat-form") as HTMLFormElement;
const input = document.getElementById("chat-input") as HTMLInputElement;
const sendBtn = form.querySelector("button") as HTMLButtonElement;
const menuBtn = document.getElementById("menu-btn") as HTMLButtonElement;
const sidebar = document.getElementById("sidebar") as HTMLElement;
const sidebarOverlay = document.getElementById(
  "sidebar-overlay"
) as HTMLButtonElement;
const conversationList = document.getElementById(
  "conversation-list"
) as HTMLUListElement;
const newConversationBtn = document.getElementById(
  "new-conversation-btn"
) as HTMLButtonElement;
const activeConversationTitleEl = document.getElementById(
  "active-conversation-title"
) as HTMLHeadingElement;
const activeConversationMetaEl = document.getElementById(
  "active-conversation-meta"
) as HTMLParagraphElement;
const deleteDialog = document.getElementById(
  "delete-dialog"
) as HTMLDialogElement;
const deleteDialogText = document.getElementById(
  "delete-dialog-text"
) as HTMLParagraphElement;
const deleteCancelBtn = document.getElementById(
  "delete-cancel-btn"
) as HTMLButtonElement;
const deleteConfirmBtn = document.getElementById(
  "delete-confirm-btn"
) as HTMLButtonElement;
const toast = document.getElementById("toast") as HTMLDivElement;
const toastText = document.getElementById("toast-text") as HTMLDivElement;
const toastUndoBtn = document.getElementById(
  "toast-undo-btn"
) as HTMLButtonElement;
const toastCloseBtn = document.getElementById(
  "toast-close-btn"
) as HTMLButtonElement;

const toolServerMap = new Map<string, ServerInfo>();
const pendingDeletes = new Map<string, PendingDelete>();

let currentConversationId: string | null = null;
let currentConversationTitle = DEFAULT_CONVERSATION_TITLE;
let conversations: ConversationSummary[] = [];
let renameConversationId: string | null = null;
let deleteConversationId: string | null = null;
let deleteConversationTitle = "";
let lastFocusedDialogTarget: HTMLElement | null = null;
let undoConversationId: string | null = null;
let toastTimer: number | null = null;
let toastCountdownTimer: number | null = null;
let sidebarOpen = false;

function getConversationSummary(id: string | null): ConversationSummary | null {
  if (!id) return null;
  return conversations.find(conversation => conversation.id === id) ?? null;
}

function setInputEnabled(enabled: boolean): void {
  input.disabled = !enabled;
  sendBtn.disabled = !enabled;
  if (enabled) input.focus();
}

function setSidebarOpen(open: boolean): void {
  sidebarOpen = open;
  document.body.classList.toggle("sidebar-open", open);
  sidebar.classList.toggle("open", open);
  sidebarOverlay.hidden = !open;
  sidebarOverlay.classList.toggle("open", open);
}

function closeSidebar(): void {
  setSidebarOpen(false);
}

function applyLocalConversationTitle(title: string): void {
  currentConversationTitle = title;

  if (currentConversationId) {
    conversations = conversations.map(conversation =>
      conversation.id === currentConversationId
        ? {
            ...conversation,
            title,
            updatedAt: new Date().toISOString()
          }
        : conversation
    );
  }

  renderConversationList();
  updateConversationHeader();
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short"
  });
}

function updateConversationHeader(): void {
  const activeConversation = getConversationSummary(currentConversationId);
  if (activeConversation) {
    currentConversationTitle = activeConversation.title;
    activeConversationTitleEl.textContent = activeConversation.title;
    activeConversationMetaEl.textContent = `Updated ${formatRelativeDate(
      activeConversation.updatedAt
    )}`;
    return;
  }

  activeConversationTitleEl.textContent = currentConversationTitle;
  activeConversationMetaEl.textContent =
    currentConversationId !== null
      ? "Saved conversation"
      : currentConversationTitle === DEFAULT_CONVERSATION_TITLE
        ? "Unsaved draft"
        : "Creating conversation";
}

function clearToastTimers(): void {
  if (toastTimer !== null) {
    globalThis.clearTimeout(toastTimer);
    toastTimer = null;
  }
  if (toastCountdownTimer !== null) {
    globalThis.clearInterval(toastCountdownTimer);
    toastCountdownTimer = null;
  }
}

function hideToast(): void {
  clearToastTimers();
  toast.classList.remove("open");
  toastUndoBtn.hidden = true;
}

function showToast(
  message: string,
  options: {
    undo?: boolean;
    duration?: number;
    countdownSeconds?: number;
    countdownFormatter?: (seconds: number) => string;
  } = {}
): void {
  const {
    undo = false,
    duration = 3000,
    countdownSeconds,
    countdownFormatter
  } = options;

  clearToastTimers();
  toastText.textContent = message;

  if (countdownSeconds && countdownSeconds > 0) {
    let remaining = countdownSeconds;
    const formatter =
      countdownFormatter ?? ((seconds: number) => `${message} (${seconds}s)`);
    toastText.textContent = formatter(remaining);
    toastCountdownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (toastCountdownTimer !== null) {
          globalThis.clearInterval(toastCountdownTimer);
          toastCountdownTimer = null;
        }
        return;
      }
      toastText.textContent = formatter(remaining);
    }, 1000);
  }

  toastUndoBtn.hidden = !undo;
  toast.classList.add("open");
  toastTimer = window.setTimeout(() => {
    hideToast();
  }, duration);
}

function renderDraftConversation(): void {
  clearMessages();
  appendAssistantMessage(WELCOME_MESSAGE);
}

function renderEmptyConversation(): void {
  clearMessages();
  appendAssistantMessage(EMPTY_CONVERSATION_MESSAGE);
}

function queuePendingToolCall(
  queue: Map<string, ToolCallEvent[]>,
  event: ToolCallEvent
): void {
  const existing = queue.get(event.name) ?? [];
  existing.push(event);
  queue.set(event.name, existing);
}

function dequeuePendingToolCall(
  queue: Map<string, ToolCallEvent[]>,
  toolName: string
): ToolCallEvent | null {
  const existing = queue.get(toolName);
  if (!existing || existing.length === 0) return null;
  const next = existing.shift() ?? null;
  if (existing.length === 0) {
    queue.delete(toolName);
  }
  return next;
}

function getStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function getObjectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function openDeleteDialog(id: string, title: string): void {
  deleteConversationId = id;
  deleteConversationTitle = title;
  deleteDialogText.textContent = `This will permanently remove "${title}".`;
  lastFocusedDialogTarget = document.activeElement as HTMLElement | null;
  deleteDialog.showModal();
  deleteConfirmBtn.focus();
}

function closeDeleteDialog(): void {
  if (deleteDialog.open) {
    deleteDialog.close();
  }
  deleteConversationId = null;
  deleteConversationTitle = "";
  lastFocusedDialogTarget?.focus();
  lastFocusedDialogTarget = null;
}

function renderConversationList(): void {
  renderConversationListView(
    {
      listElement: conversationList,
      conversations,
      currentConversationId,
      renameConversationId,
      hiddenConversationIds: new Set(pendingDeletes.keys()),
      formatMeta: formatRelativeDate
    },
    {
      onSelect: conversationId => {
        void loadConversation(conversationId);
      },
      onStartRename: conversationId => {
        renameConversationId = conversationId;
        renderConversationList();
        requestAnimationFrame(() => {
          const renameInput = conversationList.querySelector<HTMLInputElement>(
            ".conversation-rename-input"
          );
          renameInput?.focus();
          renameInput?.select();
        });
      },
      onDelete: (conversationId, title) => {
        openDeleteDialog(conversationId, title);
      },
      onSubmitRename: (conversationId, title) => {
        void renameConversation(conversationId, title);
      },
      onCancelRename: () => {
        renameConversationId = null;
        renderConversationList();
      }
    }
  );
}

async function refreshConversationList(): Promise<void> {
  try {
    conversations = await listConversations();
    const activeConversation = getConversationSummary(currentConversationId);

    if (
      !activeConversation &&
      currentConversationId &&
      !pendingDeletes.has(currentConversationId)
    ) {
      currentConversationId = null;
      currentConversationTitle = DEFAULT_CONVERSATION_TITLE;
      renderDraftConversation();
    }

    renderConversationList();
    updateConversationHeader();
  } catch (err) {
    log.error("Failed to load conversation list:", err);
    showToast("Failed to load conversations.", { duration: 3200 });
  }
}

async function renameConversation(id: string, title: string): Promise<void> {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    showToast("Title cannot be empty.", { duration: 2600 });
    return;
  }

  const current = getConversationSummary(id);
  if (current?.title === trimmedTitle) {
    renameConversationId = null;
    renderConversationList();
    return;
  }

  try {
    await renameConversationRecord(id, trimmedTitle);

    renameConversationId = null;
    if (currentConversationId === id) {
      currentConversationTitle = trimmedTitle;
    }
    await refreshConversationList();
    showToast("Conversation renamed.", { duration: 2200 });
  } catch (err) {
    log.error("Failed to rename conversation:", err);
    showToast("Failed to rename conversation.", { duration: 3200 });
  }
}

async function deleteConversation(id: string): Promise<void> {
  await deleteConversationRecord(id);
}

async function finalizeSoftDelete(id: string): Promise<void> {
  const pending = pendingDeletes.get(id);
  if (!pending) return;

  pendingDeletes.delete(id);
  if (undoConversationId === id) {
    undoConversationId = null;
  }

  try {
    await deleteConversation(id);
    await refreshConversationList();
    showToast(`Deleted "${pending.title}".`, { duration: 2200 });
  } catch (err) {
    log.error("Failed to delete conversation:", err);
    await refreshConversationList();
    showToast("Failed to delete conversation.", { duration: 3200 });
  }
}

async function undoSoftDelete(): Promise<void> {
  const id = undoConversationId;
  if (!id) return;

  const pending = pendingDeletes.get(id);
  if (!pending) return;

  globalThis.clearTimeout(pending.timer);
  pendingDeletes.delete(id);
  undoConversationId = null;
  hideToast();
  renderConversationList();
  showToast(`Restored "${pending.title}".`, { duration: 2200 });
}

async function scheduleSoftDelete(id: string, title: string): Promise<void> {
  if (pendingDeletes.has(id)) return;

  if (undoConversationId && undoConversationId !== id) {
    showToast("Finish or undo the current delete first.", { duration: 2600 });
    return;
  }

  const timer = window.setTimeout(() => {
    void finalizeSoftDelete(id);
  }, SOFT_DELETE_WINDOW_MS);

  pendingDeletes.set(id, { title, timer });
  undoConversationId = id;

  if (currentConversationId === id) {
    currentConversationId = null;
    currentConversationTitle = DEFAULT_CONVERSATION_TITLE;
    renderDraftConversation();
  }

  renderConversationList();
  updateConversationHeader();
  showToast(`Deleting "${title}"`, {
    undo: true,
    duration: SOFT_DELETE_WINDOW_MS,
    countdownSeconds: SOFT_DELETE_WINDOW_MS / 1000,
    countdownFormatter: seconds => `Deleting "${title}" in ${seconds}s`
  });
}

async function renderConversationEvents(
  events: ConversationEvent[]
): Promise<void> {
  clearMessages();

  if (events.length === 0) {
    renderEmptyConversation();
    return;
  }

  const pendingToolInputs = new Map<string, Array<Record<string, unknown>>>();

  for (const event of events) {
    if (event.type === "user_message") {
      const text = getStringValue(event.content.text);
      if (text) {
        appendUserMessage(text);
      }
      continue;
    }

    if (event.type === "assistant_message") {
      const text = getStringValue(event.content.text);
      if (text) {
        appendAssistantMessage(text);
      }
      continue;
    }

    if (event.type === "tool_call") {
      const name = getStringValue(event.content.name, "tool");
      appendToolCallMessage(name);
      const inputs = pendingToolInputs.get(name) ?? [];
      inputs.push(getObjectValue(event.content.input));
      pendingToolInputs.set(name, inputs);
      continue;
    }

    if (event.type === "tool_result") {
      const name = getStringValue(event.content.name, "tool");
      const result = getStringValue(event.content.result, "No result.");
      const hasApp = Boolean(event.content.hasApp);
      appendToolResultMessage(name, result, !hasApp);

      if (hasApp) {
        const inputs = pendingToolInputs.get(name) ?? [];
        const toolInput = inputs.shift() ?? {};
        if (inputs.length === 0) {
          pendingToolInputs.delete(name);
        } else {
          pendingToolInputs.set(name, inputs);
        }

        const toolCallInfo = buildToolCallInfo(name, toolInput, result);
        if (toolCallInfo) {
          await appendAppIframe(toolCallInfo);
        }
      }
    }
  }
}

async function loadConversation(id: string): Promise<void> {
  try {
    const payload = await getConversation(id);
    if (!payload) {
      await refreshConversationList();
      showToast("Conversation no longer exists.", { duration: 2600 });
      return;
    }

    currentConversationId = payload.conversation.id;
    currentConversationTitle = payload.conversation.title;
    renameConversationId = null;
    updateConversationHeader();
    renderConversationList();
    await renderConversationEvents(payload.events);
    closeSidebar();
    input.focus();
  } catch (err) {
    log.error("Failed to load conversation:", err);
    showToast("Failed to load conversation.", { duration: 3200 });
  }
}

async function createConversation(): Promise<void> {
  try {
    const record = await createConversationRecord();
    currentConversationId = record.id;
    currentConversationTitle = record.title;
    renameConversationId = null;
    renderEmptyConversation();
    await refreshConversationList();
    closeSidebar();
    input.focus();
  } catch (err) {
    log.error("Failed to create conversation:", err);
    showToast("Failed to create conversation.", { duration: 3200 });
  }
}

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

  const callToolResult: CallToolResult = {
    content: [{ type: "text", text: resultText }]
  };

  const info: ToolCallInfo = {
    serverInfo: server,
    tool,
    input: toolInput,
    resultPromise: Promise.resolve(callToolResult)
  };

  info.appResourcePromise = (async () => {
    return readUiResource(server, resourceUri);
  })();

  return info;
}

function parseSSEEvents(
  chunk: string,
  buffer: string
): { events: ChatEvent[]; remaining: string } {
  const combined = buffer + chunk;
  const events: ChatEvent[] = [];
  const lines = combined.split("\n");
  const remaining = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;

    try {
      events.push(JSON.parse(trimmed.slice(6)));
    } catch {
      // Ignore malformed lines.
    }
  }

  return { events, remaining };
}

function primeConversationSummary(conversationId: string): void {
  if (conversations.some(conversation => conversation.id === conversationId)) {
    return;
  }

  const now = new Date().toISOString();
  conversations = [
    {
      id: conversationId,
      title: currentConversationTitle,
      createdAt: now,
      updatedAt: now
    },
    ...conversations
  ];
  renderConversationList();
  updateConversationHeader();
}

async function sendMessage(text: string): Promise<void> {
  setInputEnabled(false);
  const shouldDeriveTitle =
    currentConversationTitle === DEFAULT_CONVERSATION_TITLE;
  if (shouldDeriveTitle) {
    applyLocalConversationTitle(deriveConversationTitle(text));
  }
  appendUserMessage(text);

  let currentAssistantEl: HTMLDivElement | null = appendAssistantMessage("");
  let currentAssistantText = "";
  let hasAnyAssistantText = false;
  const pendingToolCalls = new Map<string, ToolCallEvent[]>();

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
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        conversationId: currentConversationId
      })
    });

    if (!response.ok) {
      setAssistantMessage(`Error: ${response.status} ${response.statusText}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      setAssistantMessage("Error: No response stream");
      return;
    }

    const decoder = new TextDecoder();
    let sseBuffer = "";

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
            primeConversationSummary(event.conversationId);
            break;
          case "text":
            hideResponseSynthesisIndicator();
            appendAssistantDelta(event.text);
            break;
          case "tool_call":
            hideResponseSynthesisIndicator();
            appendToolCallMessage(event.name);
            queuePendingToolCall(pendingToolCalls, event);
            startNewAssistantBubble();
            break;
          case "tool_result": {
            appendToolResultMessage(event.name, event.result, !event.hasApp);
            if (event.hasApp) {
              const pendingToolCall = dequeuePendingToolCall(
                pendingToolCalls,
                event.name
              );
              const toolCallInfo = buildToolCallInfo(
                event.name,
                pendingToolCall?.input ?? {},
                event.result
              );
              if (toolCallInfo) {
                appendAppIframe(toolCallInfo).catch(err => {
                  log.error("Failed to render App iframe:", err);
                });
              }
            }
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
            startNewAssistantBubble();
            showSkillLoadingIndicator(event.skillName);
            break;
          case "skill_ready":
            hideSkillLoadingIndicator();
            break;
          case "done":
            hideResponseSynthesisIndicator();
            hideSkillLoadingIndicator();
            await refreshConversationList();
            break;
        }
      }
    }

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

form.addEventListener("submit", async event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await sendMessage(text);
});

newConversationBtn.addEventListener("click", async () => {
  await createConversation();
});

menuBtn.addEventListener("click", () => {
  setSidebarOpen(!sidebarOpen);
});

sidebarOverlay.addEventListener("click", () => {
  closeSidebar();
});

deleteCancelBtn.addEventListener("click", () => {
  closeDeleteDialog();
});

deleteConfirmBtn.addEventListener("click", async () => {
  if (!deleteConversationId) return;
  deleteConfirmBtn.disabled = true;
  deleteCancelBtn.disabled = true;

  try {
    await scheduleSoftDelete(deleteConversationId, deleteConversationTitle);
    closeDeleteDialog();
  } finally {
    deleteConfirmBtn.disabled = false;
    deleteCancelBtn.disabled = false;
  }
});

deleteDialog.addEventListener("cancel", event => {
  event.preventDefault();
  closeDeleteDialog();
});

toastUndoBtn.addEventListener("click", () => {
  void undoSoftDelete();
});

toastCloseBtn.addEventListener("click", () => {
  hideToast();
});

window.addEventListener("resize", () => {
  if (window.innerWidth >= 960 && sidebarOpen) {
    closeSidebar();
  }
});

renderDraftConversation();
updateConversationHeader();

async function initializeHostUi(): Promise<void> {
  try {
    await Promise.all([initMcpConnections(), refreshConversationList()]);
    log.info("Browser MCP connections ready");
    input.focus();
  } catch (err) {
    log.error("Failed to initialize host UI:", err);
  }
}

void initializeHostUi();
