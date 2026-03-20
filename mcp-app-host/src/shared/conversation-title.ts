export const DEFAULT_CONVERSATION_TITLE = "New conversation";
const MAX_DERIVED_TITLE_LENGTH = 60;

export function deriveConversationTitle(text: string): string {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (!normalized) return DEFAULT_CONVERSATION_TITLE;

  if (normalized.length <= MAX_DERIVED_TITLE_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_DERIVED_TITLE_LENGTH).trimEnd()}...`;
}
