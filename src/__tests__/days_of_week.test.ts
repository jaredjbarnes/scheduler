import { describe, expect, test } from "vitest";
import { generateDaysOfWeek } from "../generators/days_of_week";
import { Day, type DaysOfWeekRule } from "../types";
import { utcToWallParts } from "../tz";

const HOUR = 3_600_000;

describe("generateDaysOfWeek", () => {
  test("Mon/Wed/Fri at 9am UTC over a week", () => {
    const rule: DaysOfWeekRule = {
      kind: "daysOfWeek",
      days: [Day.Monday, Day.Wednesday, Day.Friday],
      weekInterval: 1,
      timeOfDay: 9 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 4, 4), // Mon May 4 2026
      seriesEnd: null,
    };
    const out = generateDaysOfWeek(rule, "UTC", Date.UTC(2026, 4, 4), Date.UTC(2026, 4, 11));
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-05-04T09:00:00.000Z", // Mon
      "2026-05-06T09:00:00.000Z", // Wed
      "2026-05-08T09:00:00.000Z", // Fri
    ]);
  });

  test("every other week: skips weeks correctly", () => {
    const rule: DaysOfWeekRule = {
      kind: "daysOfWeek",
      days: [Day.Tuesday],
      weekInterval: 2,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 4, 5), // Tue May 5 2026
      seriesEnd: null,
    };
    const out = generateDaysOfWeek(rule, "UTC", Date.UTC(2026, 4, 1), Date.UTC(2026, 5, 1));
    // Every other Tuesday starting May 5: 5, 19. (Jun 2 is outside window.)
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-05-05T00:00:00.000Z",
      "2026-05-19T00:00:00.000Z",
    ]);
  });

  test("count caps total emissions across weeks", () => {
    const rule: DaysOfWeekRule = {
      kind: "daysOfWeek",
      days: [Day.Monday, Day.Wednesday, Day.Friday],
      weekInterval: 1,
      timeOfDay: 9 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 4, 4),
      seriesEnd: null,
      count: 5,
    };
    const out = generateDaysOfWeek(rule, "UTC", Date.UTC(2026, 4, 4), Date.UTC(2026, 5, 30));
    expect(out).toHaveLength(5);
    // Mon, Wed, Fri (week 1) + Mon, Wed (week 2) = 5
    expect(new Date(out[4].startTimestamp).toISOString()).toBe("2026-05-13T09:00:00.000Z");
  });

  test("9am Monday in Denver stays at 9am wall across DST forward", () => {
    // Spring forward Sun 2025-03-09. The Mondays around it: Mar 2, Mar 9 (no
    // wait, Mar 9 is Sunday). Mar 2 (Mon, MST) and Mar 9 (Sun) — the next
    // Monday is Mar 9? No: Mar 9 is Sun, Mar 10 is Mon. Use those.
    const rule: DaysOfWeekRule = {
      kind: "daysOfWeek",
      days: [Day.Monday],
      weekInterval: 1,
      timeOfDay: 9 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2025, 2, 1),
      seriesEnd: null,
    };
    const out = generateDaysOfWeek(
      rule,
      "America/Denver",
      Date.UTC(2025, 2, 1),
      Date.UTC(2025, 2, 17)
    );
    // Mar 3 (MST), Mar 10 (MDT), and Mar 17 — but window ends at Mar 17 00:00
    // UTC. At 9am Denver on Mar 17 = 15:00 UTC, which is past 17 00:00 UTC.
    // So we expect: Mar 3, Mar 10.
    expect(out.length).toBeGreaterThanOrEqual(2);
    const isos = out.map((o) => new Date(o.startTimestamp).toISOString());
    expect(isos[0]).toBe("2025-03-03T16:00:00.000Z"); // 9am MST = 16 UTC
    expect(isos[1]).toBe("2025-03-10T15:00:00.000Z"); // 9am MDT = 15 UTC

    // And the wall-time hour in Denver is 9 for both:
    expect(utcToWallParts(out[0].startTimestamp, "America/Denver").hour).toBe(9);
    expect(utcToWallParts(out[1].startTimestamp, "America/Denver").hour).toBe(9);
  });

  test("excludes occurrences before seriesStart", () => {
    const rule: DaysOfWeekRule = {
      kind: "daysOfWeek",
      days: [Day.Sunday, Day.Monday, Day.Tuesday],
      weekInterval: 1,
      timeOfDay: 0,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 4, 5), // Tue May 5
      seriesEnd: null,
    };
    // Window starts before seriesStart. Should emit Tue May 5 only (Sun May 3
    // and Mon May 4 are before seriesStart).
    const out = generateDaysOfWeek(rule, "UTC", Date.UTC(2026, 4, 1), Date.UTC(2026, 4, 6));
    expect(out).toHaveLength(1);
    expect(new Date(out[0].startTimestamp).toISOString()).toBe("2026-05-05T00:00:00.000Z");
  });

  test("throws on weekInterval = 0", () => {
    const rule: DaysOfWeekRule = {
      kind: "daysOfWeek",
      days: [Day.Monday],
      weekInterval: 0,
      timeOfDay: 0,
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateDaysOfWeek(rule, "UTC", 0, 1000)).toThrow(/weekInterval/);
  });

  test("throws on empty days", () => {
    const rule: DaysOfWeekRule = {
      kind: "daysOfWeek",
      days: [],
      weekInterval: 1,
      timeOfDay: 0,
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateDaysOfWeek(rule, "UTC", 0, 1000)).toThrow(/non-empty/);
  });
});
