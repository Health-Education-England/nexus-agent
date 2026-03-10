import type { ToolDefinition } from "../../providers/types.js";
import { DEFAULT_TIMEZONE } from "../agent/constants.js";

export const DateTimeTool: ToolDefinition = {
  name: "get_current_datetime",
  description: `Returns the current date and time. This is the authoritative source for the current date and time — always use this tool rather than guessing or assuming the date.

If no timezone is provided, defaults to Europe/London (UK time). You can optionally provide a different IANA timezone identifier (e.g., 'America/New_York', 'Asia/Tokyo').

Returns structured data including the ISO 8601 date, time, day of week, and UTC offset.`,
  input_schema: {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description:
          "IANA timezone identifier (e.g., 'Europe/London', 'America/New_York'). Defaults to 'Europe/London' if not provided."
      }
    },
    required: []
  },
  execute: async (input: Record<string, unknown>) => {
    const now = new Date();
    const timezone = (input.timezone as string) || DEFAULT_TIMEZONE;

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

      const get = (type: string) =>
        parts.find(p => p.type === type)?.value ?? "";

      const date = `${get("year")}-${get("month")}-${get("day")}`;
      const time = `${get("hour")}:${get("minute")}:${get("second")}`;

      return JSON.stringify(
        {
          timezone,
          date,
          time,
          day_of_week: get("weekday"),
          utc_iso: now.toISOString()
        },
        null,
        2
      );
    } catch {
      return JSON.stringify({
        error: `Invalid timezone '${timezone}'.`,
        utc_iso: now.toISOString()
      });
    }
  }
};
