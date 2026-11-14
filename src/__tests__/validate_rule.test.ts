import { describe, expect, test } from "vitest";
import { InMemorySchedulerPort } from "../in_memory_port.js";
import { Scheduler } from "../scheduler.js";
import type { RecurrenceRule } from "../types.js";
import { RULE_KINDS, validateRule, validateTimeSpan } from "../validate_rule.js";

const START = Date.UTC(2026, 0, 1);
const SEVEN_AM = 7 * 60 * 60 * 1000;

// A rule as it arrives from JSON: anything at all.
const loose = (rule: unknown): RecurrenceRule => rule as RecurrenceRule;

const VALID: RecurrenceRule[] = [
  { kind: "instant", startOn: START },
  { kind: "localDateTime", year: 2026, month: 0, day: 1, timeOfDay: SEVEN_AM },
  { kind: "anchored", anchorDate: START, intervalMs: 1000, seriesStart: START, seriesEnd: null },
  {
    kind: "daysOfWeek",
    days: [1],
    weekInterval: 1,
    timeOfDay: 0,
    seriesStart: START,
    seriesEnd: null,
  },
  {
    kind: "weeksOfMonth",
    days: [0],
    weeks: [1, 3],
    monthInterval: 1,
    timeOfDay: SEVEN_AM,
    seriesStart: START,
    seriesEnd: null,
  },
  {
    kind: "monthsOfYear",
    months: [10],
    weeks: [4],
    days: [4],
    yearInterval: 1,
    timeOfDay: 0,
    seriesStart: START,
    seriesEnd: null,
    count: 3,
  },
  {
    kind: "yearly",
    month: 6,
    day: 4,
    yearInterval: 1,
    timeOfDay: 0,
    seriesStart: START,
    seriesEnd: null,
  },
  {
    kind: "daysOfMonth",
    months: [0, 1],
    daysOfMonth: [1, 15],
    yearInterval: 1,
    timeOfDay: 0,
    seriesStart: START,
    seriesEnd: START + 1,
    timeSpan: { type: "duration", ms: 60_000 },
  },
  {
    kind: "daysOfYear",
    daysOfYear: [1, 366],
    yearInterval: 1,
    timeOfDay: 0,
    seriesStart: START,
    seriesEnd: null,
  },
];

describe("validateRule accepts", () => {
  test.each(VALID.map((r) => [r.kind, r] as const))("a whole %s rule", (_kind, rule) => {
    expect(() => validateRule(rule)).not.toThrow();
  });

  test("every kind is covered here", () => {
    expect(VALID.map((r) => r.kind).sort()).toEqual([...RULE_KINDS].sort());
  });
});

// The rules an LLM sent for "the 1st and 3rd Sunday at 7am". Before, each one
// crashed inside the scheduler ("Cannot read properties of undefined", "Invalid
// time value"); now each names what is wrong.
describe("validateRule names the field that is wrong", () => {
  test("a field the kind does not have", () => {
    expect(() =>
      validateRule(loose({ kind: "weeksOfMonth", weeks: [1, 3], weekdays: [0] }))
    ).toThrow(
      'WeeksOfMonthRule has no field "weekdays" (its fields are: days, weeks, monthInterval'
    );
  });

  test("a required field that is missing, with the form it expects", () => {
    expect(() => validateRule(loose({ kind: "weeksOfMonth", weeks: [1, 3], days: [0] }))).toThrow(
      "WeeksOfMonthRule.monthInterval is required: a whole number >= 1 (1 = every month)"
    );
    expect(() =>
      validateRule(loose({ kind: "weeksOfMonth", weeks: [1, 3], days: [0], monthInterval: 1 }))
    ).toThrow("WeeksOfMonthRule.timeOfDay is required: ms after local midnight");
    expect(() =>
      validateRule(
        loose({
          kind: "weeksOfMonth",
          weeks: [1, 3],
          days: [0],
          monthInterval: 1,
          timeOfDay: SEVEN_AM,
        })
      )
    ).toThrow("WeeksOfMonthRule.seriesStart is required: a UTC timestamp in ms");
    expect(() =>
      validateRule(
        loose({
          kind: "weeksOfMonth",
          weeks: [1, 3],
          days: [0],
          monthInterval: 1,
          timeOfDay: SEVEN_AM,
          seriesStart: START,
        })
      )
    ).toThrow("WeeksOfMonthRule.seriesEnd is required: a UTC timestamp in ms or null (no end)");
  });

  test("a wrong type or value", () => {
    const base = VALID[4] as unknown as Record<string, unknown>;

    expect(() => validateRule(loose({ ...base, days: [] }))).toThrow(
      "WeeksOfMonthRule.days must be a non-empty array"
    );
    expect(() => validateRule(loose({ ...base, days: 0 }))).toThrow(
      "WeeksOfMonthRule.days must be a non-empty array"
    );
    expect(() => validateRule(loose({ ...base, days: [7] }))).toThrow("7 is out of range");
    expect(() => validateRule(loose({ ...base, weeks: [0] }))).toThrow("0 is out of range");
    expect(() => validateRule(loose({ ...base, timeOfDay: "07:00" }))).toThrow(
      "WeeksOfMonthRule.timeOfDay must be ms after local midnight"
    );
    expect(() => validateRule(loose({ ...base, seriesStart: "2026-01-01" }))).toThrow(
      "seriesStart must be a UTC timestamp"
    );
    expect(() => validateRule(loose({ ...base, count: -1 }))).toThrow(
      "count must be a whole number >= 0 or null"
    );
    expect(() => validateRule(loose({ ...base, seriesEnd: START }))).toThrow(
      "seriesEnd must be > seriesStart"
    );
  });

  test("an unknown kind, or no rule at all", () => {
    expect(() => validateRule(loose({ kind: "monthly" }))).toThrow(
      'Unknown rule kind "monthly" (expected one of instant,'
    );
    expect(() => validateRule(loose(null))).toThrow('A rule must be an object with a "kind"');
  });
});

describe("validateTimeSpan", () => {
  test("accepts nothing, a duration, or an hour span", () => {
    expect(() => validateTimeSpan(undefined)).not.toThrow();
    expect(() => validateTimeSpan({ type: "duration", ms: 1 })).not.toThrow();
    expect(() => validateTimeSpan({ type: "hourSpan", hours: 1.5 })).not.toThrow();
  });

  test("rejects anything else with the forms it takes", () => {
    expect(() => validateTimeSpan({ ms: 5 })).toThrow('timeSpan must be { "type": "duration"');
    expect(() => validateTimeSpan({ type: "duration", ms: 0 })).toThrow("timeSpan.ms must be >= 1");
  });
});

describe("the scheduler refuses a malformed rule before storing it", () => {
  test("add throws the field message and stores nothing", async () => {
    const port = new InMemorySchedulerPort<{ type: "event" }>();
    const scheduler = new Scheduler(port);

    await expect(
      scheduler.add({
        id: "t1",
        rule: loose({ kind: "weeksOfMonth", weeks: [1, 3], weekdays: [0] }),
        timezone: "UTC",
        payload: { type: "event" },
      })
    ).rejects.toThrow('has no field "weekdays"');

    expect(await port.getTemplate("t1")).toBeNull();
  });
});
