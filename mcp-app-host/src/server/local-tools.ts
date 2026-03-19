import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getSkillContent } from "./skills-registry.js";

const DEFAULT_TIMEZONE = "Europe/London";

type LocalTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** If true, this tool is a meta/infrastructure tool (e.g. read_skill) and
   *  should not be surfaced to the user as a domain tool call. */
  isMeta?: boolean;
  execute: (input: Record<string, unknown>) => Promise<CallToolResult>;
};

function toDateStringInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const get = (type: string): string =>
    parts.find(part => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function weekdayFromDateString(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    timeZone: "UTC"
  }).format(utcDate);
}

function addToDateString(
  dateString: string,
  amount: number,
  unit: "days" | "weeks" | "months" | "years"
): string {
  const [year, month, day] = dateString.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));

  switch (unit) {
    case "days":
      utcDate.setUTCDate(utcDate.getUTCDate() + amount);
      break;
    case "weeks":
      utcDate.setUTCDate(utcDate.getUTCDate() + amount * 7);
      break;
    case "months":
      utcDate.setUTCMonth(utcDate.getUTCMonth() + amount);
      break;
    case "years":
      utcDate.setUTCFullYear(utcDate.getUTCFullYear() + amount);
      break;
  }

  const y = utcDate.getUTCFullYear();
  const m = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildDateTimeResult(input: Record<string, unknown>): CallToolResult {
  const now = new Date();
  const timezone =
    typeof input.timezone === "string" && input.timezone.trim().length > 0
      ? input.timezone
      : DEFAULT_TIMEZONE;

  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "long",
      hour12: false
    }).formatToParts(now);

    const get = (type: string): string =>
      parts.find(part => part.type === type)?.value ?? "";

    const payload = {
      timezone,
      date: `${get("year")}-${get("month")}-${get("day")}`,
      time: `${get("hour")}:${get("minute")}:${get("second")}`,
      day_of_week: get("weekday"),
      utc_iso: now.toISOString()
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2)
        }
      ]
    };
  } catch {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: `Invalid timezone '${timezone}'.`,
              utc_iso: now.toISOString()
            },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }
}

function buildDateOffsetResult(input: Record<string, unknown>): CallToolResult {
  const timezone =
    typeof input.timezone === "string" && input.timezone.trim().length > 0
      ? input.timezone
      : DEFAULT_TIMEZONE;

  let amount = Number.NaN;
  if (typeof input.amount === "number") {
    amount = input.amount;
  } else if (typeof input.amount === "string") {
    amount = Number.parseInt(input.amount, 10);
  }

  const unit = typeof input.unit === "string" ? input.unit.toLowerCase() : "";

  const unitValue =
    unit === "days" || unit === "weeks" || unit === "months" || unit === "years"
      ? unit
      : null;

  if (!Number.isFinite(amount) || !unitValue) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error:
                "Invalid input. Provide numeric 'amount' and 'unit' as one of: days, weeks, months, years."
            },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }

  try {
    const baseDate =
      typeof input.base_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(input.base_date)
        ? input.base_date
        : toDateStringInTimezone(new Date(), timezone);

    const resultDate = addToDateString(baseDate, amount, unitValue);
    const payload = {
      timezone,
      base_date: baseDate,
      amount,
      unit: unitValue,
      result_date: resultDate,
      result_day_of_week: weekdayFromDateString(resultDate)
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2)
        }
      ]
    };
  } catch {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error:
                "Invalid input values. Ensure base_date uses YYYY-MM-DD and timezone is a valid IANA identifier."
            },
            null,
            2
          )
        }
      ],
      isError: true
    };
  }
}

const localTools: LocalTool[] = [
  {
    name: "read_skill",
    isMeta: true,
    description:
      "Load the full instructions for an Agent Skill before using its tools. Call this once per skill per session before invoking any tool belonging to that skill.",
    inputSchema: {
      type: "object",
      properties: {
        skill_name: {
          type: "string",
          description:
            "The name of the skill to load (e.g. 'gold-guide', 'ltft-calculator', 'date-tools')."
        }
      },
      required: ["skill_name"]
    },
    execute: async input => {
      const skillName =
        typeof input.skill_name === "string" ? input.skill_name.trim() : "";
      const content = getSkillContent(skillName);
      return { content: [{ type: "text", text: content }] };
    }
  },
  {
    name: "get_current_datetime",
    description:
      "Returns the current date and time. This is the authoritative source for current date/time. If no timezone is provided, defaults to Europe/London.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description:
            "IANA timezone identifier (e.g., 'Europe/London', 'America/New_York'). Defaults to 'Europe/London' if omitted."
        }
      },
      required: []
    },
    execute: async input => buildDateTimeResult(input)
  },
  {
    name: "calculate_date_offset",
    description:
      "Calculates a date offset from a base date by days, weeks, months, or years. Use this for calendar arithmetic instead of mental calculation.",
    inputSchema: {
      type: "object",
      properties: {
        amount: {
          type: "number",
          description:
            "Signed offset amount. Positive moves forward, negative moves backward."
        },
        unit: {
          type: "string",
          enum: ["days", "weeks", "months", "years"],
          description: "The unit to offset by."
        },
        base_date: {
          type: "string",
          description:
            "Base date in YYYY-MM-DD format. If omitted, today's date in the requested timezone is used."
        },
        timezone: {
          type: "string",
          description:
            "IANA timezone identifier used when base_date is omitted. Defaults to 'Europe/London'."
        }
      },
      required: ["amount", "unit"]
    },
    execute: async input => buildDateOffsetResult(input)
  }
];

export function getLocalTools(): LocalTool[] {
  return localTools;
}

export function getLocalToolByName(name: string): LocalTool | undefined {
  return localTools.find(tool => tool.name === name);
}

export function isMetaTool(name: string): boolean {
  return localTools.find(t => t.name === name)?.isMeta === true;
}
