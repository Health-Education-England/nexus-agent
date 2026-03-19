/**
 * Conversation store barrel — exports the store interface, file-backed
 * implementation, and the runtime singleton.
 */

export type {
  ConversationStore,
  ConversationRecord,
  ConversationEvent,
  ConversationEventType,
  ConversationSummary,
  NewConversationEvent
} from "./types.js";

export { FileConversationStore } from "./file-store.js";
