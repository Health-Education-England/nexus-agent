/**
 * Shared helpers for converting unknown errors into log-safe strings.
 */
export function formatUnknownError(value: unknown): string {
  if (value instanceof Error) return value.message;

  switch (typeof value) {
    case "undefined":
      return "undefined";
    case "object":
      if (value === null) return "null";
      try {
        return JSON.stringify(value) ?? "[unserializable-value]";
      } catch {
        return "[unserializable-value]";
      }
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
      return value.toString();
    case "symbol":
    case "function":
      return value.toString();
    default:
      return "[unserializable-value]";
  }
}

/**
 * Format an Error.cause value for appending to human-readable messages.
 */
export function formatErrorCauseSuffix(
  error: unknown,
  prefix = " [cause: ",
  suffix = "]"
): string {
  if (!(error instanceof Error) || !error.cause) return "";
  return `${prefix}${formatUnknownError(error.cause)}${suffix}`;
}
