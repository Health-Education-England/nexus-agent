import type {
  ConversationEvent,
  ConversationRecord,
  ConversationSummary
} from "../server/conversation-store/index.js";
import type { ModelContext } from "./mcp-bridge.js";

export type ConversationPayload = {
  conversation: ConversationRecord;
  events: ConversationEvent[];
};

export async function listConversations(): Promise<ConversationSummary[]> {
  const response = await fetch("/api/conversations");
  if (!response.ok) {
    throw new Error(`Failed to load conversations (${response.status})`);
  }

  return (await response.json()) as ConversationSummary[];
}

export async function getConversation(
  id: string
): Promise<ConversationPayload | null> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to load conversation (${response.status})`);
  }

  return (await response.json()) as ConversationPayload;
}

export async function createConversationRecord(): Promise<ConversationRecord> {
  const response = await fetch("/api/conversations", { method: "POST" });
  if (!response.ok) {
    throw new Error(`Failed to create conversation (${response.status})`);
  }

  return (await response.json()) as ConversationRecord;
}

export async function renameConversationRecord(
  id: string,
  title: string
): Promise<ConversationRecord> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title })
  });

  if (!response.ok) {
    throw new Error(`Failed to rename conversation (${response.status})`);
  }

  return (await response.json()) as ConversationRecord;
}

export async function deleteConversationRecord(id: string): Promise<void> {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to delete conversation (${response.status})`);
  }
}

export async function persistConversationAppContext(
  conversationId: string,
  appInstanceId: string,
  toolName: string,
  context: ModelContext
): Promise<void> {
  const response = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/app-context`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appInstanceId, toolName, context })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to persist app context (${response.status})`);
  }
}
