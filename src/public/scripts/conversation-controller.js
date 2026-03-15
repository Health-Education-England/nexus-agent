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

function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createConversationController({
  convList,
  deleteModal,
  deleteModalText,
  deleteCancelBtn,
  deleteConfirmBtn,
  toast,
  toastText,
  toastUndoBtn,
  toastCloseBtn,
  softDeleteWindowMs = 10000,
  getCurrentConversationId,
  setCurrentConversationId,
  setHistory,
  renderHistory,
  startNewChat,
  closeMobileSidebar,
  focusInput
}) {
  let pendingDeleteConversationId = null;
  let pendingDeleteConversationTitle = "";
  let lastFocusedEl = null;
  let toastTimer = null;
  let toastCountdownInterval = null;
  let undoTargetConversationId = null;
  const softDeletePending = new Map();

  bindEvents();

  return {
    clearActiveItem() {
      updateActiveItem(null);
    },
    refreshSidebar
  };

  function bindEvents() {
    deleteModal.addEventListener("click", event => {
      if (event.target === deleteModal) {
        closeDeleteModal();
      }
    });

    deleteModal.addEventListener("cancel", event => {
      event.preventDefault();
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

    deleteModal.addEventListener("keydown", event => {
      if (event.key !== "Tab" || !deleteModal.classList.contains("open")) {
        return;
      }

      const focusable = [deleteCancelBtn, deleteConfirmBtn].filter(
        el => !el.disabled
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable.at(-1);
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    });

    toastUndoBtn.addEventListener("click", () => {
      undoSoftDelete();
    });

    toastCloseBtn.addEventListener("click", () => {
      hideToast();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && deleteModal.classList.contains("open")) {
        closeDeleteModal();
      }
    });
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
    if (getCurrentConversationId() === id) {
      startNewChat();
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
    }, softDeleteWindowMs);

    softDeletePending.set(id, { title, timer });
    undoTargetConversationId = id;

    if (getCurrentConversationId() === id) {
      startNewChat();
    }

    await refreshSidebar();
    showToast(`Deleting "${title}"`, {
      undo: true,
      duration: softDeleteWindowMs,
      countdownSeconds: softDeleteWindowMs / 1000,
      countdownFormatter: seconds => `Deleting "${title}" in ${seconds}s`
    });
  }

  async function loadConversation(id) {
    try {
      const resp = await fetch(`/conversations/${encodeURIComponent(id)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      setHistory(data.messages);
      setCurrentConversationId(id);
      renderHistory(data.messages);
      updateActiveItem(id);
      focusInput();
      closeMobileSidebar();
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
        "conv-item" + (conv.id === getCurrentConversationId() ? " active" : "");
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
      deleteBtn.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openDeleteModal(conv.id, conv.title || "Untitled conversation");
      });
      deleteBtn.addEventListener("keydown", event => {
        event.stopPropagation();
      });

      item.addEventListener("click", () => loadConversation(conv.id));
      item.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          loadConversation(conv.id);
        }
      });
      convList.appendChild(item);
    }
  }
}
