import { describe, expect, test } from "vitest";
import { generateDaysOfYear } from "../generators/days_of_year";
import type { DaysOfYearRule } from "../types";

const HOUR = 3_600_000;

describe("generateDaysOfYear", () => {
  test("50th and 70th day of every year", () => {
    const rule: DaysOfYearRule = {
      kind: "daysOfYear",
      daysOfYear: [50, 70],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfYear(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2027, 0, 1));
    // 2026 (non-leap): day 50 = Feb 19, day 70 = Mar 11
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-02-19T00:00:00.000Z",
      "2026-03-11T00:00:00.000Z",
    ]);
  });

  test("day 60 differs between leap and non-leap years", () => {
    const rule: DaysOfYearRule = {
      kind: "daysOfYear",
      daysOfYear: [60],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfYear(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2027, 0, 1));
    // 2024 (leap): day 60 = Feb 29. 2025/2026 (non-leap): day 60 = Mar 1.
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-02-29T00:00:00.000Z",
      "2025-03-01T00:00:00.000Z",
      "2026-03-01T00:00:00.000Z",
    ]);
  });

  test("day 366 only emits in leap years (skipped in non-leap)", () => {
    const rule: DaysOfYearRule = {
      kind: "daysOfYear",
      daysOfYear: [366],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfYear(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2029, 0, 1));
    // Only 2024 and 2028 are leap years in this range.
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-12-31T00:00:00.000Z",
      "2028-12-31T00:00:00.000Z",
    ]);
  });

  test("day 1 (Jan 1) every year", () => {
    const rule: DaysOfYearRule = {
      kind: "daysOfYear",
      daysOfYear: [1],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfYear(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2027, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-01-01T00:00:00.000Z",
      "2025-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  test("day 365 (last day of non-leap year)", () => {
    const rule: DaysOfYearRule = {
      kind: "daysOfYear",
      daysOfYear: [365],
      yearInterval: 1,
      timeOfDay: 23 * HOUR + 59 * 60_000,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfYear(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2027, 0, 1));
    // 2024 leap: day 365 = Dec 30. 2025/2026 non-leap: day 365 = Dec 31.
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-12-30T23:59:00.000Z",
      "2025-12-31T23:59:00.000Z",
      "2026-12-31T23:59:00.000Z",
    ]);
  });

  test("yearInterval = 4 with day 366 emits each leap year", () => {
    const rule: DaysOfYearRule = {
      kind: "daysOfYear",
      daysOfYear: [366],
      yearInterval: 4,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfYear(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2033, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-12-31T00:00:00.000Z",
      "2028-12-31T00:00:00.000Z",
      "2032-12-31T00:00:00.000Z",
    ]);
  });

  test("count caps emissions", () => {
    const rule: DaysOfYearRule = {
      kind: "daysOfYear",
      daysOfYear: [50, 70, 100],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 0, 1),
      seriesEnd: null,
      count: 4,
    };
    const out = generateDaysOfYear(rule, "UTC", Date.UTC(2026, 0, 1), Date.UTC(2029, 0, 1));
    expect(out).toHaveLength(4);
  });

  test("throws on empty daysOfYear", () => {
    const rule: DaysOfYearRule = {
      kind: "daysOfYear",
      daysOfYear: [],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateDaysOfYear(rule, "UTC", 0, 1000)).toThrow(/daysOfYear/);
  });

  test("throws on day out of range (1..366)", () => {
    const rule: DaysOfYearRule = {
      kind: "daysOfYear",
      daysOfYear: [367],
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateDaysOfYear(rule, "UTC", 0, 1000)).toThrow(/daysOfYear/);
  });
});
