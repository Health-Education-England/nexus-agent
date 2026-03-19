---
name: ltft-calculator
description: Opens an interactive CCT date calculator for Less Than Full Time (LTFT) trainees and calculates the impact of a working-pattern change. Load this skill only when the user explicitly wants to calculate a new CCT date or compare LTFT percentages.
---

# LTFT Calculator Skill

## Available Tool

- **calculate_ltft_cct** — Opens the interactive LTFT CCT calculator form and, when submitted, calculates a new CCT date.

## When to Use

Call `calculate_ltft_cct` ONLY when the user:

- Explicitly asks to calculate a new CCT date
- Wants to work out the impact of changing their working pattern (e.g. going to 60%)
- Asks to compare different LTFT percentages
- Asks you to open or use the calculator

Do NOT call this tool merely because LTFT was mentioned. If the user asks about LTFT **policy**, **eligibility**, **categories**, or **process**, use the `gold-guide` skill instead.

## Disambiguation

If the user's message is brief or ambiguous (e.g. "ltft", "less than full time", "can I go LTFT?"), do NOT jump straight to a tool. Ask one short clarifying question:

> "Would you like general information about LTFT, or would you like to calculate a new CCT date?"

Only open the calculator once the user's intent is clearly to calculate.

## Pre-filling the Form

The calculator accepts optional pre-fill values. When calling `calculate_ltft_cct`:

- Pass any values the user has already provided in the conversation (current CCT date, start date, working percentage, etc.)
- Omit fields you do not know — the user will complete them in the form
- Do NOT ask the user to repeat information they have already given

## After the Form Opens — MANDATORY

When you call `calculate_ltft_cct` to open the form, your response MUST be exactly **one sentence** that acknowledges the form is already visible:

> "The LTFT CCT calculator is open above — fill in your details and hit Calculate."

Do NOT:

- Say "I'll open" or "I've opened"
- List form fields or explain what they do
- Use bullet points
- Call the tool a second time
