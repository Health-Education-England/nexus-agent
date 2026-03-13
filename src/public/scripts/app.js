const marked = globalThis.marked;
const sidebar = document.getElementById("sidebar");
const overlay = document.getElementById("overlay");
const menuBtn = document.getElementById("menu-btn");
const newChatBtn = document.getElementById("new-chat-btn");
const convList = document.getElementById("conv-list");
const deleteModal = document.getElementById("delete-modal");
const deleteModalText = document.getElementById("delete-modal-text");
const deleteCancelBtn = document.getElementById("delete-cancel-btn");
const deleteConfirmBtn = document.getElementById("delete-confirm-btn");
const toast = document.getElementById("toast");
const toastText = document.getElementById("toast-text");
const toastUndoBtn = document.getElementById("toast-undo-btn");
const toastCloseBtn = document.getElementById("toast-close-btn");
const chat = document.getElementById("chat");
const form = document.getElementById("form");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const saveInd = document.getElementById("save-indicator");

let history = [];
let currentConversationId = null;
let saveIndicatorTimer = null;
let pendingDeleteConversationId = null;
let pendingDeleteConversationTitle = "";
let lastFocusedEl = null;
let toastTimer = null;
let toastCountdownInterval = null;
let undoTargetConversationId = null;
const SOFT_DELETE_WINDOW_MS = 10000;
const softDeletePending = new Map();

menuBtn.addEventListener("click", () => {
  const isMobile = window.innerWidth <= 700;
  if (isMobile) {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("visible", sidebar.classList.contains("open"));
  } else {
    sidebar.classList.toggle("collapsed");
  }
});
overlay.addEventListener("click", () => {
  sidebar.classList.remove("open");
  overlay.classList.remove("visible");
});

function showSaved() {
  saveInd.classList.add("visible");
  clearTimeout(saveIndicatorTimer);
  saveIndicatorTimer = setTimeout(
    () => saveInd.classList.remove("visible"),
    2500
  );
}

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
});
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

function scrollToBottom() {
  chat.scrollTop = chat.scrollHeight;
}

function appendUserMessage(text) {
  const wrap = document.createElement("div");
  wrap.className = "message user";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrap.appendChild(bubble);
  chat.appendChild(wrap);
  scrollToBottom();
}

function appendAssistantMessageStatic(markdownText) {
  const wrap = document.createElement("div");
  wrap.className = "message assistant";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = marked.parse(markdownText);
  wrap.appendChild(bubble);
  chat.appendChild(wrap);
  scrollToBottom();
}

function createAssistantMessage() {
  const wrap = document.createElement("div");
  wrap.className = "message assistant streaming";
  chat.appendChild(wrap);

  let dotsEl = null;
  let preToolBubbleEl = null;
  let postToolBubbleEl = null;
  let toolsEl = null;
  let finalisingEl = null;
  let preToolRawText = "";
  let postToolRawText = "";
  let pendingToolsCount = 0;
  let phase = "pretool";

  function showDots() {
    dotsEl = document.createElement("div");
    dotsEl.className = "bubble";
    dotsEl.innerHTML =
      '<div class="typing-dots"><span></span><span></span><span></span></div>';
    wrap.appendChild(dotsEl);
    scrollToBottom();
  }

  function showToolBadge(name, pending) {
    if (!toolsEl) {
      toolsEl = document.createElement("div");
      toolsEl.style.cssText = "display:flex;flex-direction:column;gap:6px";
      wrap.appendChild(toolsEl);
    }

    phase = "posttool";
    pendingToolsCount += pending ? 1 : 0;

    const badge = document.createElement("div");
    badge.className = "tool-badge";
    badge.dataset.tool = name;
    badge.dataset.state = "pending";
    badge.innerHTML = pending
      ? `<span class="spinner"></span> ${friendlyToolName(name)}`
      : iconCheck() + " " + friendlyToolName(name);
    toolsEl.appendChild(badge);

    hideFinalising();
    scrollToBottom();
    return badge;
  }

  function resolvePendingBadge(name, success) {
    if (!toolsEl) return;
    const badges = toolsEl.querySelectorAll(`.tool-badge[data-tool="${name}"]`);
    const nextPending = Array.from(badges).find(
      badge => badge.dataset.state === "pending"
    );
    if (!nextPending) return;

    pendingToolsCount = Math.max(0, pendingToolsCount - 1);
    nextPending.dataset.state = "resolved";

    if (success) {
      nextPending.innerHTML = iconCheck() + " " + friendlyToolName(name);
    } else {
      nextPending.classList.add("error");
      nextPending.innerHTML =
        iconX() + " " + friendlyToolName(name) + " (error)";
    }

    if (pendingToolsCount === 0) {
      showFinalising();
    }
  }

  function showFinalising() {
    if (finalisingEl) return;
    finalisingEl = document.createElement("div");
    finalisingEl.className = "finalising-line";
    finalisingEl.innerHTML =
      '<div class="typing-dots"><span></span><span></span><span></span></div><span>Finalising response...</span>';
    wrap.appendChild(finalisingEl);
    scrollToBottom();
  }

  function hideFinalising() {
    if (!finalisingEl) return;
    finalisingEl.remove();
    finalisingEl = null;
  }

  function ensurePreToolBubble() {
    if (!preToolBubbleEl) {
      preToolBubbleEl = document.createElement("div");
      preToolBubbleEl.className = "bubble";
      wrap.appendChild(preToolBubbleEl);
    }
    return preToolBubbleEl;
  }

  function ensurePostToolBubble() {
    if (!postToolBubbleEl) {
      postToolBubbleEl = document.createElement("div");
      postToolBubbleEl.className = "bubble";
      wrap.appendChild(postToolBubbleEl);
    }
    return postToolBubbleEl;
  }

  function finish() {
    if (dotsEl && !preToolBubbleEl && !postToolBubbleEl) {
      dotsEl.remove();
      dotsEl = null;
    }
    hideFinalising();
  }

  function appendText(text) {
    if (dotsEl) {
      dotsEl.remove();
      dotsEl = null;
    }
    if (phase === "posttool") {
      hideFinalising();
      postToolRawText += text;
      ensurePostToolBubble().innerHTML = marked.parse(postToolRawText);
    } else {
      preToolRawText += text;
      ensurePreToolBubble().innerHTML = marked.parse(preToolRawText);
    }
    scrollToBottom();
  }

  showDots();
  return { showToolBadge, resolvePendingBadge, appendText, finish };
}

function friendlyToolName(name) {
  const map = {
    ask_gold_guide: "Consulting Gold Guide",
    ltft_calculator: "Calculating LTFT CCT",
    get_current_datetime: "Fetching date/time"
  };
  return map[name] ?? name.replaceAll("_", " ");
}

function iconCheck() {
  return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
}

function iconX() {
  return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
}

function setUI(disabled) {
  input.disabled = disabled;
  sendBtn.disabled = disabled;
}

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function startToastTimeout(ms) {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideToast(), ms);
}

function hideToast() {
  clearTimeout(toastTimer);
  clearInterval(toastCountdownInterval);
  toastCountdownInterval = null;
  toast.classList.remove("open");
  toastUndoBtn.style.display = "none";
}

function showToast(message, options = {}) {
  const {
    undo = false,
    duration = 3000,
    countdownSeconds = null,
    countdownFormatter = null
  } = options;

  clearInterval(toastCountdownInterval);
  toastCountdownInterval = null;
  toastText.textContent = message;

  if (Number.isInteger(countdownSeconds) && countdownSeconds > 0) {
    let remaining = countdownSeconds;
    const formatter =
      typeof countdownFormatter === "function"
        ? countdownFormatter
        : seconds => `${message} (${seconds}s)`;
    toastText.textContent = formatter(remaining);
    toastCountdownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(toastCountdownInterval);
        toastCountdownInterval = null;
        return;
      }
      toastText.textContent = formatter(remaining);
    }, 1000);
  }

  toastUndoBtn.style.display = undo ? "inline-flex" : "none";
  toast.classList.add("open");
  startToastTimeout(duration);
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function openDeleteModal(id, title) {
  pendingDeleteConversationId = id;
  pendingDeleteConversationTitle = title || "Untitled conversation";
  const safeTitle = title ? `"${title}"` : "this conversation";
  deleteModalText.textContent = `This will permanently remove ${safeTitle}.`;
  lastFocusedEl = document.activeElement;
  deleteModal.classList.add("open");
  if (typeof deleteModal.showModal === "function") {
    deleteModal.showModal();
  }
  deleteConfirmBtn.focus();
}

function closeDeleteModal() {
  deleteModal.classList.remove("open");
  if (typeof deleteModal.close === "function" && deleteModal.open) {
    deleteModal.close();
  }
  pendingDeleteConversationId = null;
  pendingDeleteConversationTitle = "";
  if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
    lastFocusedEl.focus();
  }
  lastFocusedEl = null;
}

async function deleteConversation(id) {
  const resp = await fetch(`/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Failed to delete conversation (${resp.status})`);
  }
  if (currentConversationId === id) {
    newChat();
  }
  await refreshSidebar();
}

async function finalizeSoftDelete(id) {
  const entry = softDeletePending.get(id);
  if (!entry) return;

  softDeletePending.delete(id);
  if (undoTargetConversationId === id) {
    undoTargetConversationId = null;
  }
  try {
    await deleteConversation(id);
    showToast(`Deleted "${entry.title}"`, { undo: false, duration: 2400 });
  } catch (err) {
    console.error("Failed to delete conversation:", err);
    showToast("Failed to delete conversation. Please try again.", {
      undo: false,
      duration: 3200
    });
    await refreshSidebar();
  }
}

async function undoSoftDelete() {
  const id = undoTargetConversationId;
  if (!id) return;
  const entry = softDeletePending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  softDeletePending.delete(id);
  undoTargetConversationId = null;
  hideToast();
  await refreshSidebar();
  showToast(`Restored "${entry.title}"`, { undo: false, duration: 2200 });
}

async function scheduleSoftDelete(id, title) {
  if (softDeletePending.has(id)) return;

  const timer = setTimeout(() => {
    finalizeSoftDelete(id);
  }, SOFT_DELETE_WINDOW_MS);

  softDeletePending.set(id, { title, timer });
  undoTargetConversationId = id;

  if (currentConversationId === id) {
    newChat();
  }

  await refreshSidebar();
  showToast(`Deleting "${title}"`, {
    undo: true,
    duration: SOFT_DELETE_WINDOW_MS,
    countdownSeconds: SOFT_DELETE_WINDOW_MS / 1000,
    countdownFormatter: seconds => `Deleting "${title}" in ${seconds}s`
  });
}

function clearChatUI() {
  chat.innerHTML = "";
}

function showWelcomeMessage() {
  const wrap = document.createElement("div");
  wrap.className = "message assistant";
  wrap.innerHTML =
    '<div class="bubble">Hello! I’m the Nexus Agent. I can answer questions about the <strong>Gold Guide 10th Edition</strong>, and help with LTFT CCT calculations. How can I help?</div>';
  chat.appendChild(wrap);
}

function newChat() {
  history = [];
  currentConversationId = null;
  clearChatUI();
  showWelcomeMessage();
  updateActiveItem(null);
  input.focus();
  if (window.innerWidth <= 700) {
    sidebar.classList.remove("open");
    overlay.classList.remove("visible");
  }
}

function renderHistory(messages) {
  clearChatUI();
  for (const msg of messages) {
    if (msg.role === "user" && typeof msg.content === "string") {
      appendUserMessage(msg.content);
    } else if (msg.role === "assistant") {
      const blocks = Array.isArray(msg.content)
        ? msg.content
        : [{ type: "text", text: msg.content }];
      const text = blocks
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("");
      if (text) appendAssistantMessageStatic(text);
    }
  }
  scrollToBottom();
}

async function loadConversation(id) {
  try {
    const resp = await fetch(`/conversations/${encodeURIComponent(id)}`);
    if (!resp.ok) return;
    const data = await resp.json();
    history = data.messages;
    currentConversationId = id;
    renderHistory(history);
    updateActiveItem(id);
    input.focus();
    if (window.innerWidth <= 700) {
      sidebar.classList.remove("open");
      overlay.classList.remove("visible");
    }
  } catch (err) {
    console.error("Failed to load conversation:", err);
  }
}

function updateActiveItem(id) {
  convList.querySelectorAll(".conv-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === id);
  });
}

async function refreshSidebar() {
  try {
    const resp = await fetch("/conversations");
    if (!resp.ok) return;
    const convs = await resp.json();
    renderSidebar(convs);
  } catch (err) {
    console.error("Failed to load conversations:", err);
  }
}

function renderSidebar(convs) {
  const visibleConvs = convs.filter(conv => !softDeletePending.has(conv.id));
  if (visibleConvs.length === 0) {
    convList.innerHTML =
      '<li class="conv-empty">No saved conversations yet.<br>Start chatting to save one.</li>';
    return;
  }
  convList.innerHTML = "";
  for (const conv of visibleConvs) {
    const item = document.createElement("li");
    item.className =
      "conv-item" + (conv.id === currentConversationId ? " active" : "");
    item.dataset.id = conv.id;
    item.setAttribute("tabindex", "0");
    const safeTitle = escapeHtml(conv.title || "Untitled conversation");
    item.innerHTML = `
			<div class="conv-title">${safeTitle}</div>
			<div class="conv-meta">${escapeHtml(formatDate(conv.updatedAt))} &middot; ${conv.messageCount} ${conv.messageCount === 1 ? "question" : "questions"}</div>
			<button class="conv-delete-btn" type="button" aria-label="Delete conversation ${safeTitle}">
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
			</button>
		`;

    const deleteBtn = item.querySelector(".conv-delete-btn");
    deleteBtn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      openDeleteModal(conv.id, conv.title || "Untitled conversation");
    });
    deleteBtn.addEventListener("keydown", e => {
      e.stopPropagation();
    });

    item.addEventListener("click", () => loadConversation(conv.id));
    item.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") loadConversation(conv.id);
    });
    convList.appendChild(item);
  }
}

deleteModal.addEventListener("click", e => {
  if (e.target === deleteModal) {
    closeDeleteModal();
  }
});

deleteModal.addEventListener("cancel", e => {
  e.preventDefault();
  closeDeleteModal();
});

deleteCancelBtn.addEventListener("click", () => {
  closeDeleteModal();
});

deleteConfirmBtn.addEventListener("click", async () => {
  const id = pendingDeleteConversationId;
  const title = pendingDeleteConversationTitle;
  if (!id) return;
  deleteConfirmBtn.disabled = true;
  deleteCancelBtn.disabled = true;
  try {
    await scheduleSoftDelete(id, title);
    closeDeleteModal();
  } catch (err) {
    console.error("Failed to delete conversation:", err);
    alert("Failed to delete conversation. Please try again.");
  } finally {
    deleteConfirmBtn.disabled = false;
    deleteCancelBtn.disabled = false;
  }
});

deleteModal.addEventListener("keydown", e => {
  if (e.key !== "Tab" || !deleteModal.classList.contains("open")) return;
  const focusable = [deleteCancelBtn, deleteConfirmBtn].filter(
    el => !el.disabled
  );
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable.at(-1);
  const active = document.activeElement;

  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
});

toastUndoBtn.addEventListener("click", () => {
  undoSoftDelete();
});

toastCloseBtn.addEventListener("click", () => {
  hideToast();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && deleteModal.classList.contains("open")) {
    closeDeleteModal();
  }
});

function parseSseEvent(frame) {
  const line = frame.trim();
  if (!line.startsWith("data: ")) return null;
  try {
    return JSON.parse(line.slice(6));
  } catch {
    return null;
  }
}

async function handleStreamEvent(event, handlers, pendingBadges) {
  switch (event.type) {
    case "text":
      handlers.appendText(event.text);
      break;

    case "tool_use":
      handlers.showToolBadge(event.name, true);
      pendingBadges[event.name] = true;
      break;

    case "tool_result":
      handlers.resolvePendingBadge(event.name, event.success);
      delete pendingBadges[event.name];
      break;

    case "error":
      handlers.appendText(`\n\n_Error: ${event.message}_`);
      break;

    case "done":
      history = event.history ?? history;
      if (event.conversationId) currentConversationId = event.conversationId;
      handlers.finish();
      showSaved();
      await refreshSidebar();
      break;
  }
}

async function streamResponse(message) {
  const handlers = createAssistantMessage();
  const pendingBadges = {};

  const response = await fetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      history,
      conversationId: currentConversationId
    })
  });

  if (!response.ok) {
    handlers.appendText("Sorry, something went wrong. Please try again.");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop();

    for (const frame of frames) {
      const event = parseSseEvent(frame);
      if (!event) continue;
      await handleStreamEvent(event, handlers, pendingBadges);
    }
  }
}

form.addEventListener("submit", async e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  input.style.height = "auto";
  setUI(true);
  appendUserMessage(text);

  try {
    await streamResponse(text);
  } catch (err) {
    console.error(err);
  } finally {
    setUI(false);
    input.focus();
  }
});

newChatBtn.addEventListener("click", newChat);

try {
  await refreshSidebar();
} catch (err) {
  console.error("Failed to initialise sidebar:", err);
}
input.focus();
