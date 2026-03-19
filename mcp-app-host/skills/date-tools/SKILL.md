---
name: date-tools
description: "Real-time date and time tools. Load this skill before answering ANY question involving today's date, current time, durations, deadlines, or date arithmetic — never guess dates from memory."
---

# Date Tools Skill

## Available Tools

- **get_current_datetime** — Returns the authoritative current date and time.
- **calculate_date_offset** — Calculates a date offset (add or subtract days, weeks, months, or years from a base date).

## When to Use Each Tool

### get_current_datetime

Call this whenever the current date or time is relevant — do NOT assume or guess the date.
Examples: "what day is it?", computing someone's age, checking if a deadline has passed, any question where "today" matters.

### calculate_date_offset

Call this for any date arithmetic — do NOT attempt mental calculation.
Examples: "13 weeks from now", "10 days after 1 April", "3 months before my CCT date".

- Pass a `base_date` (YYYY-MM-DD) if you already know it; omit it to default to today.
- Use negative `amount` values to go backwards in time.

## Timezone

Default to `Europe/London` unless the user specifies otherwise.

## Sequencing

If you need both the current date and an offset from it:

1. Call `get_current_datetime` first to get today's date.
2. Pass that date as `base_date` to `calculate_date_offset`.
