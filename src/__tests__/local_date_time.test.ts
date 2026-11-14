import { describe, expect, test } from "vitest";
import { generateLocalDateTime } from "../generators/local_date_time.js";
import type { LocalDateTimeRule } from "../types.js";

const HOUR = 3_600_000;

describe("generateLocalDateTime", () => {
  test("resolves wall-clock fields through the template tz", () => {
    // May 11 2026 09:00 in Denver is MDT (UTC-6) → 15:00 UTC.
    const rule: LocalDateTimeRule = {
      kind: "localDateTime",
      year: 2026,
      month: 4, // May
      day: 11,
      timeOfDay: 9 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
    };
    const out = generateLocalDateTime(
      rule,
      "America/Denver",
      Date.UTC(2026, 4, 1),
      Date.UTC(2026, 4, 30)
    );
    expect(out).toHaveLength(1);
    expect(out[0].startTimestamp).toBe(Date.UTC(2026, 4, 11, 15));
    expect(out[0].endTimestamp).toBe(Date.UTC(2026, 4, 11, 16));
  });

  test("with no tz, wall-clock fields are interpreted as UTC", () => {
    const rule: LocalDateTimeRule = {
      kind: "localDateTime",
      year: 2026,
      month: 4,
      day: 11,
      timeOfDay: 9 * HOUR,
    };
    const out = generateLocalDateTime(rule, undefined, Date.UTC(2026, 4, 1), Date.UTC(2026, 4, 30));
    expect(out).toHaveLength(1);
    expect(out[0].startTimestamp).toBe(Date.UTC(2026, 4, 11, 9));
  });

  test("clamps day to month length (Feb 30 → Feb 28 in a non-leap year)", () => {
    const rule: LocalDateTimeRule = {
      kind: "localDateTime",
      year: 2026, // non-leap
      month: 1, // Feb
      day: 30,
      timeOfDay: 0,
    };
    const out = generateLocalDateTime(rule, undefined, Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1));
    expect(out).toHaveLength(1);
    expect(out[0].startTimestamp).toBe(Date.UTC(2026, 1, 28));
  });

  test("hourSpan flexes across spring-forward (8 wall-hours = 7 real hours)", () => {
    // Mar 7 2026 23:00 Denver (MST, UTC-7) → 06:00 UTC Mar 8.
    // +8 wall hours lands at 07:00 wall Mar 8, now MDT (UTC-6) → 13:00 UTC.
    // Real elapsed: 7h, because the clock jumped 02:00 → 03:00 overnight.
    const rule: LocalDateTimeRule = {
      kind: "localDateTime",
      year: 2026,
      month: 2, // March
      day: 7,
      timeOfDay: 23 * HOUR,
      timeSpan: { type: "hourSpan", hours: 8 },
    };
    const out = generateLocalDateTime(
      rule,
      "America/Denver",
      Date.UTC(2026, 2, 1),
      Date.UTC(2026, 2, 31)
    );
    expect(out).toHaveLength(1);
    expect(out[0].startTimestamp).toBe(Date.UTC(2026, 2, 8, 6));
    expect(out[0].endTimestamp).toBe(Date.UTC(2026, 2, 8, 13));
    expect(out[0].endTimestamp - out[0].startTimestamp).toBe(7 * HOUR);
  });

  describe("spring-forward gap on the start (02:30 Mar 8 2026 Denver — nonexistent)", () => {
    // The clock skips 02:00 → 03:00, so 02:30 doesn't exist that day.
    const rule: LocalDateTimeRule = {
      kind: "localDateTime",
      year: 2026,
      month: 2, // March
      day: 8,
      timeOfDay: 2 * HOUR + 30 * 60_000,
    };
    const gen = (dis?: Parameters<typeof generateLocalDateTime>[4]) =>
      generateLocalDateTime(
        rule,
        "America/Denver",
        Date.UTC(2026, 2, 1),
        Date.UTC(2026, 2, 31),
        dis
      );

    test("default (compatible) moves forward to the later instant", () => {
      const out = gen();
      expect(out).toHaveLength(1);
      expect(new Date(out[0].startTimestamp).toISOString()).toBe("2026-03-08T09:30:00.000Z");
    });

    test("earlier resolves to the earlier instant", () => {
      const out = gen("earlier");
      expect(new Date(out[0].startTimestamp).toISOString()).toBe("2026-03-08T08:30:00.000Z");
    });

    test("skip drops the nonexistent occurrence", () => {
      expect(gen("skip")).toHaveLength(0);
    });

    test("reject throws", () => {
      expect(() => gen("reject")).toThrow(/gap/);
    });
  });

  test("does not emit when the occurrence is outside the window", () => {
    const rule: LocalDateTimeRule = {
      kind: "localDateTime",
      year: 2026,
      month: 4,
      day: 11,
      timeOfDay: 9 * HOUR,
    };
    const out = generateLocalDateTime(rule, undefined, Date.UTC(2026, 5, 1), Date.UTC(2026, 5, 30));
    expect(out).toHaveLength(0);
  });

  test("throws on out-of-range month", () => {
    const rule = {
      kind: "localDateTime",
      year: 2026,
      month: 12,
      day: 1,
      timeOfDay: 0,
    } as unknown as LocalDateTimeRule;
    expect(() => generateLocalDateTime(rule, undefined, 0, Date.UTC(2030, 0, 1))).toThrow();
  });
});
