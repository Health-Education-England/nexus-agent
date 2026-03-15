/**
 * show_ltft_form tool — renders an interactive LTFT CCT calculator form
 * as a card widget in the chat UI, collects the user's inputs, and returns
 * them as JSON so the agent can immediately call ltft_calculator.
 *
 * Flow:
 *  1. Agent calls show_ltft_form (with stopAfterExecute: true).
 *  2. execute() returns immediately — the inference loop ends.
 *  3. The frontend sees a successful tool_result for show_ltft_form and
 *     renders the form card inline in the conversation.
 *  4. The user fills the form and submits. The frontend injects the form
 *     data as the user's next chat message and starts a new agent turn.
 *  5. The agent calls ltft_calculator with the submitted values.
 */

import type { ToolDefinition } from "../../providers/types.js";
import { randomUUID } from "node:crypto";

export const ShowLtftFormTool: ToolDefinition = {
  name: "show_ltft_form",
  stopAfterExecute: true,

  description: `Displays an interactive LTFT CCT Calculator form card in the chat UI.

Call this tool whenever a user asks to perform an LTFT CCT calculation and you need to collect the required inputs. The tool renders a form card directly in the conversation; the user fills it in and submits it, and the tool returns all the collected values as JSON.

IMPORTANT:
- Always call show_ltft_form BEFORE calling ltft_calculator. Never ask for LTFT input values via plain text questions.
- After this tool returns, pass its JSON output directly to ltft_calculator.
- If this tool returns an error (e.g. timeout), inform the user and offer to try again.`,

  input_schema: {
    type: "object",
    properties: {
      context_note: {
        type: "string",
        description:
          "Optional short note to display in the form header, e.g. a reminder about what information is needed."
      }
    },
    required: []
  },

  execute: async (_input, ctx): Promise<string> => {
    ctx?.emit?.({
      type: "widget",
      widgetType: "ltft_form",
      widgetId: randomUUID()
    });

    // Return immediately — stopAfterExecute prevents a follow-up model call.
    // The frontend renders the form card when it sees this tool's successful
    // tool_result event.  Form data arrives as the user's next chat message.
    return (
      "LTFT calculator form displayed. The user's next message will contain " +
      "the form data as JSON — extract the values and pass them directly to " +
      "ltft_calculator without asking any follow-up questions."
    );
  }
};
