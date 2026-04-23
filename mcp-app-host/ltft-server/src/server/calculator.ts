/**
 * Pure LTFT CCT calculation logic.
 *
 * Extension = changeDays * (1 - proposedWte), where changeDays is the
 * inclusive day count from the proposed LTFT start date to the current
 * CCT date. The new CCT date is the current CCT date plus that extension.
 */

export type CalculatorInput = {
  programme_name?: string;
  current_cct_date: string;
  proposed_work_percentage: number;
  proposed_start_date: string;
};

export type CalculatorResult = {
  programme: string;
  current_cct_date: string;
  proposed_start_date: string;
  proposed_wte: string;
  extension_days: number;
  new_cct_date: string;
  extension_formatted: string;
  warnings: string[];
  summary_table_markdown: string;
};

type SummaryRow = [string, string];

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const SHORT_NOTICE_WEEKS = 16;
const SHORT_NOTICE_MS = SHORT_NOTICE_WEEKS * 7 * MS_PER_DAY;
const STANDARD_WTES = [0.5, 0.6, 0.7, 0.8] as const;

const ERROR_MESSAGES = {
  invalidCurrentCctDate: (value: string) =>
    `Invalid current CCT date '${value}'. Expected YYYY-MM-DD.`,
  invalidProposedStartDate: (value: string) =>
    `Invalid proposed start date '${value}'. Expected YYYY-MM-DD.`,
  invalidProposedWte: (value: number) =>
    `proposed_work_percentage must be between 0 and 1 (exclusive). Got ${value}.`,
  proposedDateInPast: (value: string) =>
    `Proposed start date ${value} is in the past.`,
  proposedDateAfterCct: "Proposed start date is after the current CCT date."
} as const;

const WARNING_MESSAGES = {
  shortNotice:
    "The proposed start date is within 16 weeks — classed as 'short notice', only approved for exceptional circumstances.",
  nonStandardWte: (value: number) =>
    `Proposed percentage ${(value * 100).toFixed(0)}% is not a standard LTFT percentage (50%, 60%, 70%, 80%).`
} as const;

function formatDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

function formatExtension(extensionDays: number): string {
  const years = Math.floor(extensionDays / 365);
  const days = extensionDays % 365;

  if (years > 0 && days === 0) {
    return `${years} year${years === 1 ? "" : "s"} (${extensionDays} days)`;
  }
  if (years > 0) {
    return `${years} year${years === 1 ? "" : "s"} ${days} day${days === 1 ? "" : "s"} (${extensionDays} days)`;
  }
  return `${extensionDays} day${extensionDays === 1 ? "" : "s"}`;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function parseIsoDate(
  dateString: string,
  errorMessage: (value: string) => string
): Date {
  const date = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(errorMessage(dateString));
  }
  return date;
}

function validateInput(
  input: CalculatorInput,
  endDate: Date,
  startDate: Date,
  today: Date
): void {
  if (
    input.proposed_work_percentage <= 0 ||
    input.proposed_work_percentage >= 1
  ) {
    throw new Error(
      ERROR_MESSAGES.invalidProposedWte(input.proposed_work_percentage)
    );
  }

  if (startDate < today) {
    throw new Error(
      ERROR_MESSAGES.proposedDateInPast(input.proposed_start_date)
    );
  }
  if (startDate > endDate) {
    throw new Error(ERROR_MESSAGES.proposedDateAfterCct);
  }
}

function buildWarnings(
  startDate: Date,
  today: Date,
  proposedWte: number
): string[] {
  const warnings: string[] = [];

  if (startDate.getTime() - today.getTime() < SHORT_NOTICE_MS) {
    warnings.push(WARNING_MESSAGES.shortNotice);
  }

  if (!STANDARD_WTES.some(wte => Math.abs(wte - proposedWte) < 0.01)) {
    warnings.push(WARNING_MESSAGES.nonStandardWte(proposedWte));
  }

  return warnings;
}

function calcCctExtension(
  changeStartDate: Date,
  changeEndDate: Date,
  proposedWte: number
): number {
  const changeDays =
    Math.round(
      (changeEndDate.getTime() - changeStartDate.getTime()) / MS_PER_DAY
    ) + 1;
  return Math.round(changeDays - changeDays * proposedWte);
}

function buildSummaryRows(
  programme: string,
  currentCctDate: string,
  proposedStartDate: string,
  proposedWte: string,
  newCctDate: string,
  extensionDays: number
): SummaryRow[] {
  return [
    ["Programme", programme],
    ["Current CCT date", formatDate(currentCctDate)],
    ["Proposed working percentage", proposedWte],
    ["Proposed start date", formatDate(proposedStartDate)],
    ["New CCT date", formatDate(newCctDate)],
    ["Training extension", formatExtension(extensionDays)]
  ];
}

function buildSummaryTable(rows: SummaryRow[]): string {
  const header = "| Item | Details |\n| --- | --- |";
  const body = rows
    .map(([item, details]) => `| ${item} | ${details} |`)
    .join("\n");
  return `${header}\n${body}`;
}

export function calculate(input: CalculatorInput): CalculatorResult {
  const programme = input.programme_name || "Programme";
  const endDate = parseIsoDate(
    input.current_cct_date,
    ERROR_MESSAGES.invalidCurrentCctDate
  );
  const startDate = parseIsoDate(
    input.proposed_start_date,
    ERROR_MESSAGES.invalidProposedStartDate
  );
  const wteProposed = input.proposed_work_percentage;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  validateInput(input, endDate, startDate, today);
  const warnings = buildWarnings(startDate, today, wteProposed);

  const extensionDays = calcCctExtension(startDate, endDate, wteProposed);
  const newCctDate = new Date(endDate.getTime() + extensionDays * MS_PER_DAY);

  const currentCctDate = formatIsoDate(endDate);
  const proposedStartDate = formatIsoDate(startDate);
  const newCctDateIso = formatIsoDate(newCctDate);

  const proposedWte = `${(wteProposed * 100).toFixed(0)}%`;

  const rows = buildSummaryRows(
    programme,
    currentCctDate,
    proposedStartDate,
    proposedWte,
    newCctDateIso,
    extensionDays
  );

  return {
    programme,
    current_cct_date: currentCctDate,
    proposed_start_date: proposedStartDate,
    proposed_wte: proposedWte,
    extension_days: extensionDays,
    new_cct_date: newCctDateIso,
    extension_formatted: formatExtension(extensionDays),
    warnings,
    summary_table_markdown: buildSummaryTable(rows)
  };
}
