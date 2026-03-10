import type { ToolDefinition } from "../../providers/types.js";

export const LtftCalculatorTool: ToolDefinition = {
  name: "ltft_calculator",
  description: `Calculates the new CCT (Certificate of Completion of Training) date for an NHS Doctor changing to Less Than Full Time (LTFT) training.

IMPORTANT instructions for calling this tool:
- All dates MUST be provided in ISO 8601 format: YYYY-MM-DD.
- All percentages MUST be provided as a decimal between 0 and 1 (e.g., 80% → 0.8).
- The proposed_start_date cannot be in the past.
- Don't guess today's date - use the get_current_datetime tool first.
- Standard LTFT percentages are 50%, 60%, 70%, 80% (and 100% for return to full-time).`,
  input_schema: {
    type: "object",
    properties: {
      programme_name: {
        type: "string",
        description: "Name of the training programme (optional)."
      },
      current_cct_date: {
        type: "string",
        description: "Current CCT date in YYYY-MM-DD format."
      },
      current_work_percentage: {
        type: "number",
        description: "Current WTE as a decimal between 0 and 1."
      },
      proposed_work_percentage: {
        type: "number",
        description: "Proposed WTE as a decimal between 0 and 1."
      },
      proposed_start_date: {
        type: "string",
        description: "Date the proposed LTFT change starts, YYYY-MM-DD format."
      }
    },
    required: [
      "current_cct_date",
      "current_work_percentage",
      "proposed_work_percentage",
      "proposed_start_date"
    ]
  },
  execute: async (input: Record<string, unknown>) => {
    try {
      const programmeName = (input.programme_name as string) || "Programme";
      const currentCctStr = input.current_cct_date as string;
      const wteCurrent = input.current_work_percentage as number;
      const wteProposed = input.proposed_work_percentage as number;
      const startDateStr = input.proposed_start_date as string;

      const endDate = new Date(`${currentCctStr}T00:00:00Z`);
      const startDate = new Date(`${startDateStr}T00:00:00Z`);

      if (Number.isNaN(endDate.getTime())) {
        return `Error: Invalid current CCT date '${currentCctStr}'. Expected YYYY-MM-DD format.`;
      }
      if (Number.isNaN(startDate.getTime())) {
        return `Error: Invalid proposed start date '${startDateStr}'. Expected YYYY-MM-DD format.`;
      }
      if (wteCurrent <= 0 || wteCurrent > 1) {
        return `Error: current_work_percentage must be between 0 (exclusive) and 1 (inclusive). Got ${wteCurrent}.`;
      }
      if (wteProposed <= 0 || wteProposed > 1) {
        return `Error: proposed_work_percentage must be between 0 (exclusive) and 1 (inclusive). Got ${wteProposed}.`;
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      if (startDate < today) {
        return `Error: Proposed start date ${startDateStr} is in the past.`;
      }
      if (startDate > endDate) {
        return `Error: Proposed start date ${startDateStr} is after the current CCT date ${currentCctStr}.`;
      }

      const warnings: string[] = [];
      const weeks16InMs = 16 * 7 * 24 * 60 * 60 * 1000;
      if (startDate.getTime() - today.getTime() < weeks16InMs) {
        warnings.push(
          "The proposed start date is within 16 weeks. This is classed as 'short notice' and will only be approved for exceptional circumstances."
        );
      }

      const standardWtes = [0.5, 0.6, 0.7, 0.8, 1.0];
      if (!standardWtes.some(s => Math.abs(s - wteProposed) < 0.01)) {
        warnings.push(
          `Proposed percentage ${(wteProposed * 100).toFixed(0)}% is not a standard LTFT percentage (50%, 60%, 70%, 80%, 100%).`
        );
      }

      const msPerDay = 1000 * 60 * 60 * 24;
      const remainingDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / msPerDay
      );
      const adjustedDays = Math.ceil(
        (remainingDays * wteCurrent) / wteProposed
      );
      const extensionDays = adjustedDays - remainingDays;

      const newCctDate = new Date(endDate.getTime() + extensionDays * msPerDay);
      const fmt = (d: Date) => d.toISOString().split("T")[0];

      const result: Record<string, unknown> = {
        programme: programmeName,
        current_cct_date: fmt(endDate),
        proposed_start_date: fmt(startDate),
        current_wte: `${(wteCurrent * 100).toFixed(0)}%`,
        proposed_wte: `${(wteProposed * 100).toFixed(0)}%`,
        remaining_days_in_current_period: remainingDays,
        adjusted_days_at_new_wte: adjustedDays,
        extension_days: extensionDays,
        new_cct_date: fmt(newCctDate),
        warnings: warnings.length > 0 ? warnings : undefined
      };
      return JSON.stringify(result, null, 2);
    } catch (error) {
      const err = error as Error;
      return `Error calculating CCT change: ${err.message || String(error)}`;
    }
  }
};
