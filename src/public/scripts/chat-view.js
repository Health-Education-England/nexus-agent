import { appendAssistantMessageStatic } from "./assistant-renderer.js";

export function createChatView({ chat, markdown, scrollToBottom }) {
  return {
    appendUserMessage,
    clearChat,
    renderHistory,
    resetToWelcome,
    showWelcomeMessage
  };

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

  function clearChat() {
    chat.innerHTML = "";
  }

  function showWelcomeMessage() {
    const wrap = document.createElement("div");
    wrap.className = "message assistant";
    wrap.innerHTML =
      '<div class="bubble">Hello! I’m the Nexus Agent. I can answer questions about the <strong>Gold Guide 10th Edition</strong>, and help with LTFT CCT calculations. How can I help?</div>';
    chat.appendChild(wrap);
  }

  function resetToWelcome() {
    clearChat();
    showWelcomeMessage();
  }

  function renderHistory(messages) {
    clearChat();
    for (const msg of messages) {
      if (msg.role === "user" && typeof msg.content === "string") {
        const ltftPayload = tryParseLtftSubmission(msg.content);
        if (ltftPayload) {
          appendUserLtftSubmission(ltftPayload);
        } else {
          appendUserMessage(msg.content);
        }
      } else if (msg.role === "assistant") {
        const blocks = Array.isArray(msg.content)
          ? msg.content
          : [{ type: "text", text: msg.content }];
        const text = blocks
          .filter(block => block.type === "text")
          .map(block => block.text)
          .join("");

        if (text) {
          appendAssistantMessageStatic({
            chat,
            markdown,
            markdownText: text,
            scrollToBottom
          });
        }
      }
    }
    scrollToBottom();
  }

  function appendUserLtftSubmission(payload) {
    const wrap = document.createElement("div");
    wrap.className = "message user";

    const bubble = document.createElement("div");
    bubble.className = "bubble ltft-user-submission";

    const title = document.createElement("div");
    title.className = "ltft-user-submission-title";
    title.textContent = "LTFT form submitted";

    const details = document.createElement("div");
    details.className = "ltft-user-submission-details";

    const currentPct = `${Math.round(payload.current_work_percentage * 100)}%`;
    const proposedPct = `${Math.round(payload.proposed_work_percentage * 100)}%`;
    const parts = [
      `Current CCT: ${formatTrainingDate(payload.current_cct_date)}`,
      `WTE: ${currentPct} → ${proposedPct}`,
      `Start: ${formatTrainingDate(payload.proposed_start_date)}`
    ];

    if (typeof payload.programme_name === "string" && payload.programme_name) {
      parts.unshift(`Programme: ${payload.programme_name}`);
    }

    details.textContent = parts.join(" · ");

    bubble.appendChild(title);
    bubble.appendChild(details);
    wrap.appendChild(bubble);
    chat.appendChild(wrap);
    scrollToBottom();
  }
}

function tryParseLtftSubmission(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const requiredKeys = [
      "current_cct_date",
      "current_work_percentage",
      "proposed_work_percentage",
      "proposed_start_date"
    ];

    const hasRequiredKeys = requiredKeys.every(key => key in parsed);
    if (!hasRequiredKeys) return null;

    if (
      typeof parsed.current_cct_date !== "string" ||
      typeof parsed.proposed_start_date !== "string" ||
      typeof parsed.current_work_percentage !== "number" ||
      typeof parsed.proposed_work_percentage !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function formatTrainingDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}
