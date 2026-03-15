import { streamChatResponse } from "./chat-stream.js";
import { createAssistantMessage, iconCheck } from "./assistant-renderer.js";
import { createChatView } from "./chat-view.js";
import { createConversationController } from "./conversation-controller.js";
import { createWidgetRegistry } from "./widget-registry.js";

const marked = globalThis.marked;
if (marked?.setOptions) {
  marked.setOptions({
    gfm: true,
    breaks: false
  });
}
const elements = {
  sidebar: document.getElementById("sidebar"),
  overlay: document.getElementById("overlay"),
  menuBtn: document.getElementById("menu-btn"),
  newChatBtn: document.getElementById("new-chat-btn"),
  convList: document.getElementById("conv-list"),
  deleteModal: document.getElementById("delete-modal"),
  deleteModalText: document.getElementById("delete-modal-text"),
  deleteCancelBtn: document.getElementById("delete-cancel-btn"),
  deleteConfirmBtn: document.getElementById("delete-confirm-btn"),
  toast: document.getElementById("toast"),
  toastText: document.getElementById("toast-text"),
  toastUndoBtn: document.getElementById("toast-undo-btn"),
  toastCloseBtn: document.getElementById("toast-close-btn"),
  chat: document.getElementById("chat"),
  form: document.getElementById("form"),
  input: document.getElementById("input"),
  sendBtn: document.getElementById("send"),
  saveInd: document.getElementById("save-indicator")
};

const appState = {
  history: [],
  currentConversationId: null,
  saveIndicatorTimer: null
};

elements.menuBtn.addEventListener("click", () => {
  const isMobile = window.innerWidth <= 700;
  if (isMobile) {
    elements.sidebar.classList.toggle("open");
    elements.overlay.classList.toggle(
      "visible",
      elements.sidebar.classList.contains("open")
    );
  } else {
    elements.sidebar.classList.toggle("collapsed");
  }
});
elements.overlay.addEventListener("click", () => {
  elements.sidebar.classList.remove("open");
  elements.overlay.classList.remove("visible");
});

function closeMobileSidebar() {
  if (window.innerWidth <= 700) {
    elements.sidebar.classList.remove("open");
    elements.overlay.classList.remove("visible");
  }
}

function showSaved() {
  elements.saveInd.classList.add("visible");
  clearTimeout(appState.saveIndicatorTimer);
  appState.saveIndicatorTimer = setTimeout(
    () => elements.saveInd.classList.remove("visible"),
    2500
  );
}

elements.input.addEventListener("input", () => {
  elements.input.style.height = "auto";
  elements.input.style.height =
    Math.min(elements.input.scrollHeight, 160) + "px";
});
elements.input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    elements.form.requestSubmit();
  }
});

function scrollToBottom() {
  elements.chat.scrollTop = elements.chat.scrollHeight;
}

const chatView = createChatView({
  chat: elements.chat,
  markdown: marked,
  scrollToBottom
});

function setUI(disabled) {
  elements.input.disabled = disabled;
  elements.sendBtn.disabled = disabled;
}

function newChat() {
  appState.history = [];
  appState.currentConversationId = null;
  chatView.resetToWelcome();
  conversationController.clearActiveItem();
  elements.input.focus();
  closeMobileSidebar();
}

const conversationController = createConversationController({
  convList: elements.convList,
  deleteModal: elements.deleteModal,
  deleteModalText: elements.deleteModalText,
  deleteCancelBtn: elements.deleteCancelBtn,
  deleteConfirmBtn: elements.deleteConfirmBtn,
  toast: elements.toast,
  toastText: elements.toastText,
  toastUndoBtn: elements.toastUndoBtn,
  toastCloseBtn: elements.toastCloseBtn,
  getCurrentConversationId: () => appState.currentConversationId,
  setCurrentConversationId: id => {
    appState.currentConversationId = id;
  },
  setHistory: messages => {
    appState.history = messages;
  },
  renderHistory: chatView.renderHistory,
  startNewChat: newChat,
  closeMobileSidebar,
  focusInput: () => elements.input.focus()
});

const widgetRegistry = createWidgetRegistry({
  chat: elements.chat,
  input: elements.input,
  scrollToBottom,
  streamResponse,
  setUI,
  iconCheck
});

function getWidgetPreamble(widgetType) {
  return widgetRegistry[widgetType]?.preamble ?? null;
}

async function streamResponse(message) {
  await streamChatResponse({
    message,
    history: appState.history,
    conversationId: appState.currentConversationId,
    createAssistantMessage: () =>
      createAssistantMessage({
        chat: elements.chat,
        markdown: marked,
        scrollToBottom
      }),
    getWidgetPreamble,
    renderWidget,
    onDone: async event => {
      appState.history = event.history ?? appState.history;
      if (event.conversationId) {
        appState.currentConversationId = event.conversationId;
      }
      showSaved();
      await conversationController.refreshSidebar();
    }
  });
}

// ── Widget rendering ──────────────────────────────────────────────────────────
//
// This uses an MCP Apps-like interaction pattern, but not the MCP Apps
// protocol itself. nexus-agent is a standalone Express app, not an MCP host,
// so widgets are delivered over the existing SSE chat stream rather than via
// MCP UI resources and host-managed model-context updates.
// a tool triggers an interactive UI card that renders inline in the conversation. The tool emits a dedicated
// widget SSE event, then returns immediately. When the user submits the form,
// the data is injected as their next chat message and a new agent turn begins —
// no suspended promises, no timeouts, no long-lived connections.
//
// MCP Apps equivalent: the tool returns _meta.ui.resourceUri, the MCP host
// renders a sandboxed iframe, and the SDK delivers the result via
// app.updateModelContext().
// See: https://modelcontextprotocol.io/docs/extensions/apps

function renderWidget(widgetType, widgetId) {
  widgetRegistry[widgetType]?.render(widgetId);
}

// ── Chat form submission ───────────────────────────────────────────────────────

elements.form.addEventListener("submit", async e => {
  e.preventDefault();
  const text = elements.input.value.trim();
  if (!text) return;

  elements.input.value = "";
  elements.input.style.height = "auto";
  setUI(true);
  chatView.appendUserMessage(text);

  try {
    await streamResponse(text);
  } catch (err) {
    console.error(err);
  } finally {
    setUI(false);
    elements.input.focus();
  }
});

elements.newChatBtn.addEventListener("click", newChat);

try {
  await conversationController.refreshSidebar();
} catch (err) {
  console.error("Failed to initialise sidebar:", err);
}
elements.input.focus();
