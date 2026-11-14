import { describe, expect, test } from "vitest";
import { generateYearly } from "../generators/yearly.js";
import { Month, type YearlyRule } from "../types.js";

const HOUR = 3_600_000;

describe("generateYearly", () => {
  test("every June 11", () => {
    const rule: YearlyRule = {
      kind: "yearly",
      month: Month.June,
      day: 11,
      yearInterval: 1,
      timeOfDay: 9 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateYearly(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2027, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-06-11T09:00:00.000Z",
      "2025-06-11T09:00:00.000Z",
      "2026-06-11T09:00:00.000Z",
    ]);
  });

  test("every other Jan 1", () => {
    const rule: YearlyRule = {
      kind: "yearly",
      month: Month.January,
      day: 1,
      yearInterval: 2,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateYearly(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2030, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "2028-01-01T00:00:00.000Z",
    ]);
  });

  test("Feb 29 falls back to Feb 28 in non-leap years", () => {
    const rule: YearlyRule = {
      kind: "yearly",
      month: Month.February,
      day: 29,
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
    };
    const out = generateYearly(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2027, 0, 1));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2024-02-29T00:00:00.000Z", // leap
      "2025-02-28T00:00:00.000Z", // fallback
      "2026-02-28T00:00:00.000Z", // fallback
    ]);
  });

  test("count caps emissions", () => {
    const rule: YearlyRule = {
      kind: "yearly",
      month: Month.July,
      day: 4,
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2024, 0, 1),
      seriesEnd: null,
      count: 2,
    };
    const out = generateYearly(rule, "UTC", Date.UTC(2024, 0, 1), Date.UTC(2030, 0, 1));
    expect(out).toHaveLength(2);
  });

  test("throws on month out of range", () => {
    const rule: YearlyRule = {
      kind: "yearly",
      month: 12 as Month,
      day: 1,
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateYearly(rule, "UTC", 0, 1000)).toThrow(/month/);
  });

  test("throws on day < 1 or > 31", () => {
    const rule: YearlyRule = {
      kind: "yearly",
      month: Month.January,
      day: 32,
      yearInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateYearly(rule, "UTC", 0, 1000)).toThrow(/day/);
  });
});
