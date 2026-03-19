---
name: gold-guide
description: Use for Gold Guide policy and process questions about NHS postgraduate medical training. Do not use for LTFT or working-pattern CCT calculations.
---

# Gold Guide Skill

## Available Tool

- **ask_gold_guide** — Searches the Gold Guide and returns a precise answer with inline citation IDs.

## When to Use

Use `ask_gold_guide` for questions involving:

- Training programme rules, requirements, or entitlements
- ARCP (Annual Review of Competence Progression)
- LTFT (Less Than Full Time) policy, eligibility, categories, or process
- OOP (Out of Programme) — OOPC, OOPT, OOPR
- Parental leave, flexible working, sickness absence rules
- Deanery/LETB responsibilities, TPD roles, Educational Supervisors
- Gold Guide definitions, timescales, or procedures

Do NOT use `ask_gold_guide` when the user wants to calculate or compare CCT outcomes after an LTFT or working-pattern change. Use `ltft-calculator` instead.

## Citation Rules — MANDATORY

The `ask_gold_guide` tool returns answers with inline citation IDs (e.g. `3.123`, `3.126 ii`) and a CITATIONS block.

You MUST:

1. **Preserve all citation IDs inline** for every factual statement derived from the tool, formatted as parenthetical references:
   - e.g. "All trainees can apply for LTFT training (3.123)."
2. **Include a References section** at the end of your response listing the cited paragraph numbers.
3. **End the References section** with:
   > All references are from the Gold Guide 10th Edition (August 2024): https://www.copmed.org.uk/images/docs/goldguide10thedition/Gold%20Guide%2010th%20Edition%20August%202024.pdf

Never strip, paraphrase away, or omit citation IDs. If the tool provides a citation for a fact, your response must include it.

## LTFT Cross-Awareness

When `ask_gold_guide` returns an answer about LTFT policy, eligibility, categories, process, or less-than-full-time training, append exactly one short offer at the end of the response, but only if the user is not already in a calculator flow:

> "If you'd like to calculate your new CCT date, just ask and I'll open the calculator for you."

Treat the user as already in a calculator flow if any of the following is true:

- `calculate_ltft_cct` has already been called earlier in the conversation
- the user is already discussing calculator inputs, entered values, or form results
- the user is asking to calculate or compare CCT outcomes rather than asking a policy question

Do NOT add this offer for unrelated policy topics.
Do NOT add any extra calculator invitation beyond this sentence.
