import { describe, expect, test } from "vitest";
import { generateWeeksOfMonth } from "../generators/weeks_of_month.js";
import { Day, type WeeksOfMonthRule } from "../types.js";

const HOUR = 3_600_000;

describe("generateWeeksOfMonth", () => {
  test("2nd Tuesday of every month for a quarter", () => {
    const rule: WeeksOfMonthRule = {
      kind: "weeksOfMonth",
      days: [Day.Tuesday],
      weeks: [2],
      monthInterval: 1,
      timeOfDay: 14 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateWeeksOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1));
    // 2nd Tuesdays: Jan 13, Feb 10, Mar 10
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-01-13T14:00:00.000Z",
      "2026-02-10T14:00:00.000Z",
      "2026-03-10T14:00:00.000Z",
    ]);
  });

  test("last Friday of every month", () => {
    const rule: WeeksOfMonthRule = {
      kind: "weeksOfMonth",
      days: [Day.Friday],
      weeks: [-1],
      monthInterval: 1,
      timeOfDay: 17 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateWeeksOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2026, 3, 1));
    // Last Fridays: Jan 30, Feb 27, Mar 27
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-01-30T17:00:00.000Z",
      "2026-02-27T17:00:00.000Z",
      "2026-03-27T17:00:00.000Z",
    ]);
  });

  test("5th Friday: emits only in months that have one", () => {
    const rule: WeeksOfMonthRule = {
      kind: "weeksOfMonth",
      days: [Day.Friday],
      weeks: [5],
      monthInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateWeeksOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    // 2026: months with a 5th Friday are Jan (30), May (29), Jul (31), Oct (30).
    // Wait — let me recompute: 5th Friday means the month has 5 Fridays.
    // Jan 2026 Fridays: 2,9,16,23,30 → 5 Fridays, 5th = 30
    // May 2026 Fridays: 1,8,15,22,29 → 5 Fridays, 5th = 29
    // Jul 2026 Fridays: 3,10,17,24,31 → 5 Fridays, 5th = 31
    // Oct 2026 Fridays: 2,9,16,23,30 → 5 Fridays, 5th = 30
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-01-30T00:00:00.000Z",
      "2026-05-29T00:00:00.000Z",
      "2026-07-31T00:00:00.000Z",
      "2026-10-30T00:00:00.000Z",
    ]);
  });

  test("every other month: skips months correctly", () => {
    const rule: WeeksOfMonthRule = {
      kind: "weeksOfMonth",
      days: [Day.Wednesday],
      weeks: [1],
      monthInterval: 2,
      timeOfDay: 12 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateWeeksOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2026, 6, 1));
    // 1st Wed of Jan/Mar/May 2026 = Jan 7, Mar 4, May 6
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-01-07T12:00:00.000Z",
      "2026-03-04T12:00:00.000Z",
      "2026-05-06T12:00:00.000Z",
    ]);
  });

  test("throws on week = 0", () => {
    const rule: WeeksOfMonthRule = {
      kind: "weeksOfMonth",
      days: [Day.Monday],
      weeks: [0],
      monthInterval: 1,
      timeOfDay: 0,
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateWeeksOfMonth(rule, "UTC", 0, 1000)).toThrow(/week/);
  });

  test("throws on monthInterval = 0", () => {
    const rule: WeeksOfMonthRule = {
      kind: "weeksOfMonth",
      days: [Day.Monday],
      weeks: [1],
      monthInterval: 0,
      timeOfDay: 0,
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateWeeksOfMonth(rule, "UTC", 0, 1000)).toThrow(/monthInterval/);
  });

  test("first AND last week: Mon/Wed/Fri on weeks [1, -1] of every month", () => {
    // The user's original use case.
    const rule: WeeksOfMonthRule = {
      kind: "weeksOfMonth",
      days: [Day.Monday, Day.Wednesday, Day.Friday],
      weeks: [1, -1],
      monthInterval: 1,
      timeOfDay: 9 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateWeeksOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1));
    // Jan 2026 starts Thursday. Days of week:
    //   Thu Jan 1, Fri Jan 2 (1st Fri), Sat Jan 3, Sun Jan 4,
    //   Mon Jan 5 (1st Mon), Tue Jan 6, Wed Jan 7 (1st Wed), ...
    // Last week of Jan 2026:
    //   Mon Jan 26 (last Mon), Wed Jan 28 (last Wed), Fri Jan 30 (last Fri).
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-01-02T09:00:00.000Z", // 1st Fri
      "2026-01-05T09:00:00.000Z", // 1st Mon
      "2026-01-07T09:00:00.000Z", // 1st Wed
      "2026-01-26T09:00:00.000Z", // last Mon
      "2026-01-28T09:00:00.000Z", // last Wed
      "2026-01-30T09:00:00.000Z", // last Fri
    ]);
  });

  test("multiple positive weeks: 1st, 3rd, 5th Tuesday", () => {
    const rule: WeeksOfMonthRule = {
      kind: "weeksOfMonth",
      days: [Day.Tuesday],
      weeks: [1, 3, 5],
      monthInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 5, 1),
      seriesEnd: null,
    };
    // June 2026 Tuesdays: 2, 9, 16, 23, 30 → 1st=2, 3rd=16, 5th=30
    const out = generateWeeksOfMonth(rule, "UTC", Date.UTC(2026, 5, 1), Date.UTC(2026, 6, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-06-02T00:00:00.000Z",
      "2026-06-16T00:00:00.000Z",
      "2026-06-30T00:00:00.000Z",
    ]);
  });

  test("duplicate weeks are deduped (no double-emit)", () => {
    const rule: WeeksOfMonthRule = {
      kind: "weeksOfMonth",
      days: [Day.Monday],
      weeks: [1, 1, 1],
      monthInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateWeeksOfMonth(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1));
    expect(out).toHaveLength(1); // 1st Monday of Jan 2026 = Jan 5
  });

  test("throws on empty weeks", () => {
    const rule: WeeksOfMonthRule = {
      kind: "weeksOfMonth",
      days: [Day.Monday],
      weeks: [],
      monthInterval: 1,
      timeOfDay: 0,
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateWeeksOfMonth(rule, "UTC", 0, 1000)).toThrow(/weeks/);
  });
});
