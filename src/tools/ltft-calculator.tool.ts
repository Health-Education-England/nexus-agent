import type { ToolDefinition } from "../../providers/types.js";

type SummaryRow = { item: string; details: string };

function formatIsoDateForDisplay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

function formatTrainingExtension(extensionDays: number): string {
  const years = Math.floor(extensionDays / 365);
  const daysRemainder = extensionDays % 365;

  if (years > 0 && daysRemainder === 0) {
    return `${years} year${years === 1 ? "" : "s"} (${extensionDays} days)`;
  }
  if (years > 0) {
    return `${years} year${years === 1 ? "" : "s"} ${daysRemainder} day${daysRemainder === 1 ? "" : "s"} (${extensionDays} days)`;
  }
  return `${extensionDays} day${extensionDays === 1 ? "" : "s"}`;
}

function buildSummaryTable(rows: SummaryRow[]): string {
  const header = "| Item | Details |\n| --- | --- |";
  const body = rows.map(row => `| ${row.item} | ${row.details} |`).join("\n");
  return `${header}\n${body}`;
}

export const LtftCalculatorTool: ToolDefinition = {
  name: "ltft_calculator",
  description: `Calculates the new CCT (Certificate of Completion of Training) date for an NHS Doctor changing to Less Than Full Time (LTFT) training.

IMPORTANT instructions for calling this tool:
- All dates MUST be provided in ISO 8601 format: YYYY-MM-DD.
- proposed_work_percentage MUST be a decimal between 0 and 1 exclusive (e.g., 80% → 0.8).
- The proposed_start_date cannot be in the past.
- Don't guess today's date - use the get_current_datetime tool first.
- Standard LTFT percentages are 50%, 60%, 70%, 80%.`,
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
      proposed_work_percentage: {
        type: "number",
        description: "Proposed WTE as a decimal between 0 and 1 (exclusive)."
      },
      proposed_start_date: {
        type: "string",
        description: "Date the proposed LTFT change starts, YYYY-MM-DD format."
      }
    },
    required: [
      "current_cct_date",
      "proposed_work_percentage",
      "proposed_start_date"
    ]
  },
  execute: async (input: Record<string, unknown>) => {
    try {
      const programmeName = (input.programme_name as string) || "Programme";
      const currentCctStr = input.current_cct_date as string;
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
      if (wteProposed <= 0 || wteProposed >= 1) {
        return `Error: proposed_work_percentage must be between 0 and 1 (exclusive). Got ${wteProposed}.`;
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

      const standardWtes = [0.5, 0.6, 0.7, 0.8];
      if (!standardWtes.some(s => Math.abs(s - wteProposed) < 0.01)) {
        warnings.push(
          `Proposed percentage ${(wteProposed * 100).toFixed(0)}% is not a standard LTFT percentage (50%, 60%, 70%, 80%).`
        );
      }

      const msPerDay = 1000 * 60 * 60 * 24;
      const changeDays =
        Math.round((endDate.getTime() - startDate.getTime()) / msPerDay) + 1;
      const extensionDays = Math.round(changeDays - changeDays * wteProposed);

      const newCctDate = new Date(endDate.getTime() + extensionDays * msPerDay);
      const fmt = (d: Date) => d.toISOString().split("T")[0];

      const result: Record<string, unknown> = {
        programme: programmeName,
        current_cct_date: fmt(endDate),
        proposed_start_date: fmt(startDate),
        proposed_wte: `${(wteProposed * 100).toFixed(0)}%`,
        extension_days: extensionDays,
        new_cct_date: fmt(newCctDate),
        warnings: warnings.length > 0 ? warnings : undefined
      };

      const summaryRows: SummaryRow[] = [
        { item: "Programme", details: programmeName },
        {
          item: "Current CCT date",
          details: formatIsoDateForDisplay(result.current_cct_date as string)
        },
        {
          item: "Proposed working percentage",
          details: result.proposed_wte as string
        },
        {
          item: "Proposed start date",
          details: formatIsoDateForDisplay(result.proposed_start_date as string)
        },
        {
          item: "New CCT date",
          details: formatIsoDateForDisplay(result.new_cct_date as string)
        },
        {
          item: "Training extension",
          details: formatTrainingExtension(result.extension_days as number)
        }
      ];

      result.summary_rows = summaryRows;
      result.summary_table_markdown = buildSummaryTable(summaryRows);

      return JSON.stringify(result, null, 2);
    } catch (error) {
      const err = error as Error;
      return `Error calculating CCT change: ${err.message || String(error)}`;
    }
  }
};
