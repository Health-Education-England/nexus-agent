const TOOL_NAME_MAP = {
  ask_gold_guide: "Consulting Gold Guide",
  ltft_calculator: "Calculating LTFT CCT",
  get_current_datetime: "Fetching date/time",
  show_ltft_form: "Opening LTFT calculator form"
};

export function appendAssistantMessageStatic({
  chat,
  markdown,
  markdownText,
  scrollToBottom
}) {
  const wrap = document.createElement("div");
  wrap.className = "message assistant";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = markdown.parse(markdownText);

  wrap.appendChild(bubble);
  chat.appendChild(wrap);
  scrollToBottom();
}

export function createAssistantMessage({ chat, markdown, scrollToBottom }) {
  const wrap = document.createElement("div");
  wrap.className = "message assistant streaming";
  chat.appendChild(wrap);

  let postToolWrapEl = null;
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
    if (!postToolWrapEl) {
      postToolWrapEl = document.createElement("div");
      postToolWrapEl.className = "message assistant streaming";
      chat.appendChild(postToolWrapEl);
    }
    if (!postToolBubbleEl) {
      postToolBubbleEl = document.createElement("div");
      postToolBubbleEl.className = "bubble";
      postToolWrapEl.appendChild(postToolBubbleEl);
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
      ensurePostToolBubble().innerHTML = markdown.parse(postToolRawText);
    } else {
      preToolRawText += text;
      ensurePreToolBubble().innerHTML = markdown.parse(preToolRawText);
    }

    scrollToBottom();
  }

  showDots();
  return { showToolBadge, resolvePendingBadge, appendText, finish };
}

function friendlyToolName(name) {
  return TOOL_NAME_MAP[name] ?? name.replaceAll("_", " ");
}

export function iconCheck() {
  return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
}

function iconX() {
  return '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
}
