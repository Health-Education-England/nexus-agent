/**
 * Conversation store contracts.
 *
 * Backend-agnostic — implement ConversationStore to swap JSON files for
 * Postgres, SQLite, etc.
 *
 * - "Conversation" = container metadata (id, title, timestamps).
 * - "Event"        = append-only timeline item inside a conversation.
 */

export type ConversationEventType =
  | "user_message"
  | "assistant_message"
  | "tool_call"
  | "tool_result"
  | "app_context_update"
  | "skill_load"
  | "skill_ready";

export type ConversationRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  metadata?: Record<string, unknown>;
};

export type ConversationEvent = {
  id: string;
  conversationId: string;
  seq: number;
  type: ConversationEventType;
  role?: "user" | "assistant";
  content: Record<string, unknown>;
  createdAt: string;
};

export type NewConversationEvent = Omit<
  ConversationEvent,
  "id" | "conversationId" | "seq" | "createdAt"
>;

export type ConversationSummary = Pick<
  ConversationRecord,
  "id" | "title" | "createdAt" | "updatedAt"
>;

export type ConversationUpdate = Partial<
  Pick<ConversationRecord, "title" | "model" | "metadata">
>;

/**
 * Swap-friendly storage interface.
 * Every method is async so implementations can use file I/O, HTTP, or a DB.
 */
export type ConversationStore = {
  /** Create a new conversation, returning its record. */
  create(title?: string): Promise<ConversationRecord>;

  /** Get conversation metadata (null if not found). */
  get(id: string): Promise<ConversationRecord | null>;

  /** Update mutable conversation metadata (null if not found). */
  update(
    id: string,
    updates: ConversationUpdate
  ): Promise<ConversationRecord | null>;

  /** List conversations, most-recently-updated first. */
  list(): Promise<ConversationSummary[]>;

  /** Append events to a conversation's timeline. */
  appendEvents(
    conversationId: string,
    events: NewConversationEvent[]
  ): Promise<ConversationEvent[]>;

  /** Read all events for a conversation, ordered by sequence. */
  getEvents(conversationId: string): Promise<ConversationEvent[]>;

  /** Delete conversations older than `maxAgeDays`. Returns count deleted. */
  purgeOlderThan(maxAgeDays: number): Promise<number>;

  /** Delete a single conversation. */
  delete(id: string): Promise<boolean>;
};
