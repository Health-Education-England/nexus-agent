---
name: ltft-calculator
description: Use for LTFT CCT date calculations or working-pattern change calculations. If the user provides any concrete calculation detail, call the calculator immediately. Do not use for LTFT policy or process questions.
---

# LTFT Calculator

## Trigger

Use this skill when the user wants to:

- calculate a new CCT date
- calculate the effect of a working-pattern change on a CCT date

Treat the following as calculation intent:

- a date
- a percentage
- a timeline
- a start date
- a current CCT date
- a request to open or use the calculator

## Do Not Use

Do not use this skill for LTFT policy, eligibility, category, or process questions with no calculation intent.
Use `gold-guide` instead.

## Required Action

Call `calculate_ltft_cct` immediately in the same turn.

Pre-fill any values already provided.

Do not:

- ask for missing details before calling the tool
- list required fields in chat
- wait for the user to supply all inputs in chat

## Clarification Rule

Ask a clarifying question only if the message contains no calculation intent at all.
Examples:

- "ltft"
- "can I go LTFT?"

## Required First Response

After calling `calculate_ltft_cct`, reply with exactly this sentence and nothing else:

"The LTFT CCT calculator is open above — fill in your details and hit Calculate."

## Subsequent Turns

Do not call the tool again unless the user explicitly asks to open another calculator, for example to compare scenarios side by side.
Instead, tell the user they can update the form and press Calculate again to compare different scenarios.
