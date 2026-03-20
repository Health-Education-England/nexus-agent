import type { ConversationSummary } from "../server/conversation-store/index.js";

type ConversationListOptions = {
  listElement: HTMLUListElement;
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  renameConversationId: string | null;
  hiddenConversationIds: Set<string>;
  formatMeta: (isoDate: string) => string;
};

type ConversationListHandlers = {
  onSelect: (conversationId: string) => void;
  onStartRename: (conversationId: string) => void;
  onDelete: (conversationId: string, title: string) => void;
  onSubmitRename: (conversationId: string, title: string) => void;
  onCancelRename: () => void;
};

export function renderConversationListView(
  options: ConversationListOptions,
  handlers: ConversationListHandlers
): void {
  const {
    listElement,
    conversations,
    currentConversationId,
    renameConversationId,
    hiddenConversationIds,
    formatMeta
  } = options;

  const visibleConversations = conversations.filter(
    conversation => !hiddenConversationIds.has(conversation.id)
  );

  listElement.innerHTML = "";

  if (visibleConversations.length === 0) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "conversation-empty";
    emptyItem.textContent = "No saved conversations yet.";
    listElement.appendChild(emptyItem);
    return;
  }

  for (const conversation of visibleConversations) {
    const item = document.createElement("li");
    item.className = "conversation-item";
    item.dataset.id = conversation.id;

    if (renameConversationId === conversation.id) {
      item.classList.add("editing");

      const formEl = document.createElement("form");
      formEl.className = "conversation-rename-form";

      const inputEl = document.createElement("input");
      inputEl.className = "conversation-rename-input";
      inputEl.type = "text";
      inputEl.maxLength = 120;
      inputEl.value = conversation.title;
      inputEl.setAttribute("aria-label", "Conversation title");

      const actionRow = document.createElement("div");
      actionRow.className = "conversation-rename-actions";

      const saveBtn = document.createElement("button");
      saveBtn.type = "submit";
      saveBtn.className = "conversation-inline-btn primary";
      saveBtn.textContent = "Save";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "conversation-inline-btn";
      cancelBtn.textContent = "Cancel";

      cancelBtn.addEventListener("click", () => {
        handlers.onCancelRename();
      });

      formEl.addEventListener("submit", event => {
        event.preventDefault();
        handlers.onSubmitRename(conversation.id, inputEl.value);
      });

      inputEl.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          handlers.onCancelRename();
        }
      });

      actionRow.append(saveBtn, cancelBtn);
      formEl.append(inputEl, actionRow);
      item.appendChild(formEl);
      listElement.appendChild(item);
      continue;
    }

    if (conversation.id === currentConversationId) {
      item.classList.add("active");
    }

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = "conversation-select";
    selectBtn.setAttribute(
      "aria-label",
      `Load conversation ${conversation.title}`
    );

    const titleEl = document.createElement("span");
    titleEl.className = "conversation-title";
    titleEl.textContent = conversation.title;

    const metaEl = document.createElement("span");
    metaEl.className = "conversation-meta";
    metaEl.textContent = `Updated ${formatMeta(conversation.updatedAt)}`;

    selectBtn.append(titleEl, metaEl);
    selectBtn.addEventListener("click", () => {
      handlers.onSelect(conversation.id);
    });

    const actions = document.createElement("div");
    actions.className = "conversation-actions";

    const renameBtn = document.createElement("button");
    renameBtn.type = "button";
    renameBtn.className = "conversation-action-btn";
    renameBtn.textContent = "Rename";
    renameBtn.addEventListener("click", () => {
      handlers.onStartRename(conversation.id);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "conversation-action-btn danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      handlers.onDelete(conversation.id, conversation.title);
    });

    actions.append(renameBtn, deleteBtn);
    item.append(selectBtn, actions);
    listElement.appendChild(item);
  }
}
