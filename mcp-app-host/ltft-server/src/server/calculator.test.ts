import test from "node:test";
import assert from "node:assert/strict";
import { calculate } from "./calculator.js";

function addDays(base: Date, days: number): string {
  const date = new Date(base);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

function validInput(overrides: Partial<Parameters<typeof calculate>[0]> = {}) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  return {
    current_cct_date: addDays(today, 365),
    proposed_work_percentage: 0.8,
    proposed_start_date: addDays(today, 30),
    ...overrides
  };
}

test("throws on invalid current CCT date", () => {
  assert.throws(
    () =>
      calculate(
        validInput({
          current_cct_date: "not-a-date"
        })
      ),
    /Invalid current CCT date/
  );
});

test("throws when proposed start date is in the past", () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  assert.throws(
    () =>
      calculate(
        validInput({
          proposed_start_date: addDays(today, -1)
        })
      ),
    /is in the past/
  );
});

test("throws when proposed start date is after current CCT date", () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  assert.throws(
    () =>
      calculate(
        validInput({
          current_cct_date: addDays(today, 60),
          proposed_start_date: addDays(today, 90)
        })
      ),
    /after the current CCT date/
  );
});

test("adds warning for non-standard WTE", () => {
  const result = calculate(
    validInput({
      proposed_work_percentage: 0.77
    })
  );

  assert.ok(
    result.warnings.some(warning =>
      warning.includes("not a standard LTFT percentage")
    )
  );
});

test("adds warning within 16 weeks short-notice boundary", () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const result = calculate(
    validInput({
      proposed_start_date: addDays(today, 111)
    })
  );

  assert.ok(
    result.warnings.some(warning => warning.includes("within 16 weeks"))
  );
});

test("does not add short-notice warning at exactly 16 weeks", () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const result = calculate(
    validInput({
      proposed_start_date: addDays(today, 112)
    })
  );

  assert.ok(
    !result.warnings.some(warning => warning.includes("within 16 weeks"))
  );
});
