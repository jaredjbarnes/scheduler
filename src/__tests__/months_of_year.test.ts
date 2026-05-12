import { describe, expect, test } from "vitest";
import { generateMonthsOfYear } from "../generators/months_of_year";
import { Day, Month, type MonthsOfYearRule } from "../types";

const HOUR = 3_600_000;

describe("generateMonthsOfYear — positional", () => {
  test("Thanksgiving: 4th Thursday of November every year", () => {
    const rule: MonthsOfYearRule = {
      kind: "monthsOfYear",
      months: [Month.November],
      weeks: [4],
      days: [Day.Thursday],
      yearInterval: 1,
      timeOfDay: 12 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateMonthsOfYear(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2027, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-11-28T12:00:00.000Z",
      "2025-11-27T12:00:00.000Z",
      "2026-11-26T12:00:00.000Z",
    ]);
  });

  test("Mother's Day: 2nd Sunday of May every year", () => {
    const rule: MonthsOfYearRule = {
      kind: "monthsOfYear",
      months: [Month.May],
      weeks: [2],
      days: [Day.Sunday],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateMonthsOfYear(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2027, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-05-12T00:00:00.000Z",
      "2025-05-11T00:00:00.000Z",
      "2026-05-10T00:00:00.000Z",
    ]);
  });

  test("1st Monday of Jan AND Jul, every year", () => {
    const rule: MonthsOfYearRule = {
      kind: "monthsOfYear",
      months: [Month.January, Month.July],
      weeks: [1],
      days: [Day.Monday],
      yearInterval: 1,
      timeOfDay: 9 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateMonthsOfYear(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    // Jan 2026: 1st Mon = Jan 5. Jul 2026: 1st Mon = Jul 6.
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-07-06T09:00:00.000Z",
    ]);
  });

  test("last Friday of every quarter (Mar/Jun/Sep/Dec)", () => {
    const rule: MonthsOfYearRule = {
      kind: "monthsOfYear",
      months: [Month.March, Month.June, Month.September, Month.December],
      weeks: [-1],
      days: [Day.Friday],
      yearInterval: 1,
      timeOfDay: 17 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateMonthsOfYear(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-03-27T17:00:00.000Z",
      "2026-06-26T17:00:00.000Z",
      "2026-09-25T17:00:00.000Z",
      "2026-12-25T17:00:00.000Z",
    ]);
  });

  test("5th Sunday of every month: emits only when it exists", () => {
    // Only fires in months that have a 5th occurrence of the weekday.
    const rule: MonthsOfYearRule = {
      kind: "monthsOfYear",
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
      weeks: [5],
      days: [Day.Sunday],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateMonthsOfYear(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    // 2026 5th Sundays: Mar 29, May 31, Aug 30, Nov 29
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-03-29T00:00:00.000Z",
      "2026-05-31T00:00:00.000Z",
      "2026-08-30T00:00:00.000Z",
      "2026-11-29T00:00:00.000Z",
    ]);
  });

  test("first AND last week, multiple weekdays", () => {
    const rule: MonthsOfYearRule = {
      kind: "monthsOfYear",
      months: [Month.June],
      weeks: [1, -1],
      days: [Day.Monday, Day.Friday],
      yearInterval: 1,
      timeOfDay: 8 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateMonthsOfYear(rule, "UTC", Date.UTC(2026, 5, 1), Date.UTC(2026, 6, 1));
    // June 2026: Mondays = 1, 8, 15, 22, 29; Fridays = 5, 12, 19, 26
    // 1st Mon = Jun 1, 1st Fri = Jun 5, last Mon = Jun 29, last Fri = Jun 26
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-06-01T08:00:00.000Z",
      "2026-06-05T08:00:00.000Z",
      "2026-06-26T08:00:00.000Z",
      "2026-06-29T08:00:00.000Z",
    ]);
  });

  test("yearInterval = 2", () => {
    const rule: MonthsOfYearRule = {
      kind: "monthsOfYear",
      months: [Month.January],
      weeks: [1],
      days: [Day.Monday],
      yearInterval: 2,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateMonthsOfYear(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2030, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-01-01T00:00:00.000Z", // Mon Jan 1 2024
      "2026-01-05T00:00:00.000Z",
      "2028-01-03T00:00:00.000Z",
    ]);
  });

  test("count caps emissions", () => {
    const rule: MonthsOfYearRule = {
      kind: "monthsOfYear",
      months: [Month.January, Month.July],
      weeks: [1],
      days: [Day.Monday],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
      count: 3,
    };
    const out = generateMonthsOfYear(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2030, 0, 1));
    expect(out).toHaveLength(3);
  });

  test("throws on empty months / weeks / days", () => {
    const base = {
      kind: "monthsOfYear" as const,
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR } as const,
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() =>
      generateMonthsOfYear({ ...base, months: [], weeks: [1], days: [Day.Monday] }, "UTC", 0, 1000)
    ).toThrow(/months/);
    expect(() =>
      generateMonthsOfYear(
        { ...base, months: [Month.January], weeks: [], days: [Day.Monday] },
        "UTC",
        0,
        1000
      )
    ).toThrow(/weeks/);
    expect(() =>
      generateMonthsOfYear(
        { ...base, months: [Month.January], weeks: [1], days: [] },
        "UTC",
        0,
        1000
      )
    ).toThrow(/days/);
  });

  test("throws on weeks entry of 0", () => {
    const rule: MonthsOfYearRule = {
      kind: "monthsOfYear",
      months: [Month.January],
      weeks: [0],
      days: [Day.Monday],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateMonthsOfYear(rule, "UTC", 0, 1000)).toThrow(/weeks/);
  });
});
