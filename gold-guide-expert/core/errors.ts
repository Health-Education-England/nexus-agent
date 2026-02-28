/**
 * Custom error types for the Gold Guide domain.
 * These allow the orchestrator to catch and gracefully handle
 * known failures.
 */

export class RetrievalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetrievalError";
  }
}

export class ContextExhaustionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextExhaustionError";
  }
}

// Add more custom errors here as needed (e.g. ParsingError, OutputFormatError)
