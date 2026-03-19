/**
 * Shared SSE event types for /api/chat streaming.
 * Used by both the server (agent.ts) and client (main.ts).
 */

/** Conversation ID assigned to this chat stream (sent first). */
export type ConversationIdEvent = {
  type: "conversation_id";
  conversationId: string;
};

/** Assistant text chunk. */
export type TextEvent = {
  type: "text";
  text: string;
};

/** Tool call initiated — client may render a tool indicator or MCP App iframe. */
export type ToolCallEvent = {
  type: "tool_call";
  name: string;
  input: Record<string, unknown>;
};

/** Tool call result returned. */
export type ToolResultEvent = {
  type: "tool_result";
  name: string;
  result: string;
  hasApp: boolean;
  resourceUri?: string;
};

/** Stream complete. */
export type DoneEvent = {
  type: "done";
};

/** Error during processing. */
export type ErrorEvent = {
  type: "error";
  message: string;
};

/** Agent Skill is being loaded (read_skill called). */
export type SkillLoadEvent = {
  type: "skill_load";
  skillName: string;
};

/** Agent Skill has finished loading and its tools are now available. */
export type SkillReadyEvent = {
  type: "skill_ready";
  skillName: string;
};

export type ChatEvent =
  | ConversationIdEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | DoneEvent
  | ErrorEvent
  | SkillLoadEvent
  | SkillReadyEvent;
