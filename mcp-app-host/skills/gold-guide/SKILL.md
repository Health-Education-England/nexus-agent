---
name: gold-guide
description: Answers policy questions about NHS postgraduate medical training using the Gold Guide (10th Edition, August 2024). Load this skill for questions about training rules, ARCP, LTFT policy, OOP, programme management, or any Gold Guide topic.
---

# Gold Guide Skill

## Available Tool

- **ask_gold_guide** — Searches the Gold Guide and returns a precise answer with inline citation IDs.

## When to Use

Use `ask_gold_guide` for any question involving:

- Training programme rules, requirements, or entitlements
- ARCP (Annual Review of Competence Progression)
- LTFT (Less Than Full Time) policy, eligibility, categories, or process
- OOP (Out of Programme) — OOPC, OOPT, OOPR
- Parental leave, flexible working, sickness absence rules
- Deanery/LETB responsibilities, TPD roles, Educational Supervisors
- Gold Guide definitions, timescales, or procedures

Do NOT use `ask_gold_guide` when the user wants to **calculate** a CCT date — that requires the `ltft-calculator` skill.

## Citation Rules — MANDATORY

The `ask_gold_guide` tool returns answers with inline citation IDs (e.g. `3.123`, `3.126 ii`) and a CITATIONS block.

You MUST:

1. **Preserve all citation IDs inline** wherever the underlying fact appears in your response, formatted as parenthetical references:
   - e.g. "All trainees can apply for LTFT training (3.123)."
2. **Include a References section** at the end of your response listing the cited paragraph numbers.
3. **End the References section** with:
   > All references are from the Gold Guide 10th Edition (August 2024): https://www.copmed.org.uk/images/docs/goldguide10thedition/Gold%20Guide%2010th%20Edition%20August%202024.pdf

Never strip, paraphrase, or omit citation IDs. If the tool provided a citation for a fact, your response must include it.

## LTFT Cross-Awareness

When `ask_gold_guide` returns an answer related to LTFT or less-than-full-time training, and you have not yet called `calculate_ltft_cct`, end your response with exactly one short offer:

> "If you'd like to calculate your new CCT date, just ask and I'll open the calculator for you."

Do NOT add this offer for unrelated policy topics.
