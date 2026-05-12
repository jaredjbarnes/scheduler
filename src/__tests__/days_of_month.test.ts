import { describe, expect, test } from "vitest";
import { generateDaysOfMonth } from "../generators/days_of_month";
import { type DaysOfMonthRule, Month } from "../types";

const HOUR = 3_600_000;

describe("generateDaysOfMonth", () => {
  test("15th of Jan and Mar, every other year", () => {
    const rule: DaysOfMonthRule = {
      kind: "daysOfMonth",
      months: [Month.January, Month.March],
      daysOfMonth: [15],
      yearInterval: 2,
      timeOfDay: 9 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfMonth(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2029, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-01-15T09:00:00.000Z",
      "2024-03-15T09:00:00.000Z",
      "2026-01-15T09:00:00.000Z",
      "2026-03-15T09:00:00.000Z",
      "2028-01-15T09:00:00.000Z",
      "2028-03-15T09:00:00.000Z",
    ]);
  });

  test("payroll: 1st and 15th of every month", () => {
    const rule: DaysOfMonthRule = {
      kind: "daysOfMonth",
      months: [
        Month.January,
        Month.February,
        Month.March,
        Month.April,
        Month.May,
        Month.June,
        Month.July,
        Month.August,
        Month.September,
        Month.October,
        Month.November,
        Month.December,
      ],
      daysOfMonth: [1, 15],
      yearInterval: 1,
      timeOfDay: 6 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    expect(out).toHaveLength(24); // 12 months × 2 days
    expect(new Date(out[0].startTimestamp).toISOString()).toBe("2026-01-01T06:00:00.000Z");
    expect(new Date(out[1].startTimestamp).toISOString()).toBe("2026-01-15T06:00:00.000Z");
    expect(new Date(out[23].startTimestamp).toISOString()).toBe("2026-12-15T06:00:00.000Z");
  });

  test("quarterly tax dates", () => {
    const rule: DaysOfMonthRule = {
      kind: "daysOfMonth",
      months: [Month.January, Month.April, Month.July, Month.September],
      daysOfMonth: [15],
      yearInterval: 1,
      timeOfDay: 9 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-01-15T09:00:00.000Z",
      "2026-04-15T09:00:00.000Z",
      "2026-07-15T09:00:00.000Z",
      "2026-09-15T09:00:00.000Z",
    ]);
  });

  test("day 31 clamps to last day of shorter months", () => {
    const rule: DaysOfMonthRule = {
      kind: "daysOfMonth",
      months: [Month.January, Month.April],
      daysOfMonth: [31],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-01-31T00:00:00.000Z", // Jan has 31
      "2026-04-30T00:00:00.000Z", // Apr clamps to 30
    ]);
  });

  test("day 30 + day 31 in April: dedup after clamp", () => {
    // Both clamp to Apr 30 — should only emit once.
    const rule: DaysOfMonthRule = {
      kind: "daysOfMonth",
      months: [Month.April],
      daysOfMonth: [30, 31],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    expect(out).toHaveLength(1);
    expect(new Date(out[0].startTimestamp).toISOString()).toBe("2026-04-30T00:00:00.000Z");
  });

  test("count caps emissions across months × days", () => {
    const rule: DaysOfMonthRule = {
      kind: "daysOfMonth",
      months: [Month.January, Month.July],
      daysOfMonth: [1, 15],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
      count: 3,
    };
    const out = generateDaysOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    expect(out).toHaveLength(3);
  });

  test("throws on empty months / daysOfMonth", () => {
    const base = {
      kind: "daysOfMonth" as const,
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR } as const,
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() =>
      generateDaysOfMonth({ ...base, months: [], daysOfMonth: [1] }, "UTC", 0, 1000)
    ).toThrow(/months/);
    expect(() =>
      generateDaysOfMonth({ ...base, months: [Month.January], daysOfMonth: [] }, "UTC", 0, 1000)
    ).toThrow(/daysOfMonth/);
  });

  test("throws on day out of range", () => {
    const rule: DaysOfMonthRule = {
      kind: "daysOfMonth",
      months: [Month.January],
      daysOfMonth: [32],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateDaysOfMonth(rule, "UTC", 0, 1000)).toThrow(/daysOfMonth/);
  });
});
