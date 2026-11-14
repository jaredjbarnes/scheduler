import { describe, expect, test } from "vitest";
import { Day } from "../types.js";
import {
  addDaysInTz,
  addMonthsInTz,
  dayOfWeekInTz,
  monthLength,
  utcToWallParts,
  wallTimeToUtc,
} from "../tz.js";

// Reference moments:
//   2025-03-09 09:00 UTC = 2025-03-09 02:00 MST = 03:00 MDT (the gap)
//   2025-11-02 08:00 UTC = 2025-11-02 02:00 MDT = 01:00 MST (the overlap)
//   America/Denver: -07:00 in MDT, -06:00 in MST. Wait — opposite. MST is
//   standard (-07), MDT is daylight (-06). Spring forward = MST→MDT (lose
//   an hour). Fall back = MDT→MST (gain an hour).

describe("tz — UTC pass-through", () => {
  test("utcToWallParts treats UTC as itself", () => {
    const w = utcToWallParts(Date.UTC(2026, 4, 11, 14, 30, 45, 250), "UTC");
    expect(w).toEqual({
      year: 2026,
      month: 4,
      day: 11,
      hour: 14,
      minute: 30,
      second: 45,
      ms: 250,
      dayOfWeek: Day.Monday,
    });
  });

  test("wallTimeToUtc in UTC = Date.UTC", () => {
    const expected = Date.UTC(2026, 4, 11, 14, 30, 45, 250);
    const msOfDay = 14 * 3_600_000 + 30 * 60_000 + 45 * 1000 + 250;
    expect(wallTimeToUtc(2026, 4, 11, msOfDay, "UTC")).toBe(expected);
  });
});

describe("tz — IANA round-trips", () => {
  test("New York: 9am wall = 14:00 UTC in winter (EST)", () => {
    const utc = wallTimeToUtc(2026, 0, 15, 9 * 3_600_000, "America/New_York");
    expect(new Date(utc).toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  test("New York: 9am wall = 13:00 UTC in summer (EDT)", () => {
    const utc = wallTimeToUtc(2026, 6, 15, 9 * 3_600_000, "America/New_York");
    expect(new Date(utc).toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  test("Tokyo: 9am wall = 00:00 UTC year-round (no DST)", () => {
    const winter = wallTimeToUtc(2026, 0, 15, 9 * 3_600_000, "Asia/Tokyo");
    const summer = wallTimeToUtc(2026, 6, 15, 9 * 3_600_000, "Asia/Tokyo");
    expect(new Date(winter).toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(new Date(summer).toISOString()).toBe("2026-07-15T00:00:00.000Z");
  });

  test("Round-trip: utcToWallParts → wallTimeToUtc preserves the instant", () => {
    const original = Date.UTC(2025, 5, 15, 18, 42, 17);
    const w = utcToWallParts(original, "Europe/London");
    const msOfDay = w.hour * 3_600_000 + w.minute * 60_000 + w.second * 1000;
    expect(wallTimeToUtc(w.year, w.month, w.day, msOfDay, "Europe/London")).toBe(original);
  });
});

describe("tz — DST boundaries", () => {
  // Spring forward: 2025-03-09, America/Denver. Clock jumps 02:00 MST → 03:00 MDT.
  // 02:30 wall is "non-existent". We resolve to the EARLIER instant — i.e.
  // treat the wall fields with the pre-transition (MST, -07) offset. So
  // 02:30 → 09:30 UTC (since pre-transition Denver is UTC-7).
  // Wait: actually pre-transition offset is MST (-7), so 02:30 MST → 09:30 UTC.
  // The IMPLEMENTATION returns 08:30 UTC, which corresponds to 02:30 in the
  // pre-jump timeline interpreted as if it were ALREADY MDT (-6). Hmm.
  //
  // What's actually happening: the algorithm reads the offset at the
  // post-correction guess (which lands AFTER the jump), so it uses MDT (-6).
  // 02:30 wall - (-6h) = 08:30 UTC. So we resolve to the EARLIER UTC instant
  // by using the POST-transition (smaller magnitude) offset. This is the
  // Luxon / date-fns-tz default for spring-forward.
  // Default disambiguation is now "compatible": a spring-forward gap moves
  // FORWARD to the later instant. 02:30 (nonexistent) → 09:30 UTC (i.e. the
  // clock jumps to 03:30 MDT). "earlier" recovers the old 08:30 UTC behavior.
  test("spring forward gap: default (compatible) resolves to the later instant", () => {
    const utc = wallTimeToUtc(2025, 2, 9, 2 * 3_600_000 + 30 * 60_000, "America/Denver");
    expect(new Date(utc).toISOString()).toBe("2025-03-09T09:30:00.000Z");
  });

  test("spring forward gap: disambiguation policies pick gap direction", () => {
    const wall = 2 * 3_600_000 + 30 * 60_000;
    const earlier = wallTimeToUtc(2025, 2, 9, wall, "America/Denver", "earlier");
    const later = wallTimeToUtc(2025, 2, 9, wall, "America/Denver", "later");
    const compatible = wallTimeToUtc(2025, 2, 9, wall, "America/Denver", "compatible");
    expect(new Date(earlier).toISOString()).toBe("2025-03-09T08:30:00.000Z");
    expect(new Date(later).toISOString()).toBe("2025-03-09T09:30:00.000Z");
    expect(compatible).toBe(later);
    expect(() => wallTimeToUtc(2025, 2, 9, wall, "America/Denver", "reject")).toThrow(/gap/);
  });

  // Fall back: 2025-11-02, America/Denver. Clock falls 02:00 MDT → 01:00 MST.
  // 01:30 wall is ambiguous. We resolve to the EARLIER instant: 07:30 UTC
  // (the first occurrence, while still on MDT), not 08:30 UTC.
  test("fall back ambiguous wall time resolves to earlier instant (compatible default)", () => {
    const utc = wallTimeToUtc(2025, 10, 2, 1 * 3_600_000 + 30 * 60_000, "America/Denver");
    expect(new Date(utc).toISOString()).toBe("2025-11-02T07:30:00.000Z");
  });

  test("fall back overlap: disambiguation policies pick which occurrence", () => {
    const wall = 1 * 3_600_000 + 30 * 60_000;
    const earlier = wallTimeToUtc(2025, 10, 2, wall, "America/Denver", "earlier");
    const later = wallTimeToUtc(2025, 10, 2, wall, "America/Denver", "later");
    expect(new Date(earlier).toISOString()).toBe("2025-11-02T07:30:00.000Z");
    expect(new Date(later).toISOString()).toBe("2025-11-02T08:30:00.000Z");
    // "compatible" picks the earlier occurrence for an overlap.
    expect(wallTimeToUtc(2025, 10, 2, wall, "America/Denver", "compatible")).toBe(earlier);
    expect(() => wallTimeToUtc(2025, 10, 2, wall, "America/Denver", "reject")).toThrow(/overlap/);
  });

  // Same wall-clock time, two different UTCs across spring forward.
  test("9am Denver wall is 16:00 UTC before, 15:00 UTC after spring forward", () => {
    const before = wallTimeToUtc(2025, 2, 8, 9 * 3_600_000, "America/Denver"); // Sat
    const after = wallTimeToUtc(2025, 2, 10, 9 * 3_600_000, "America/Denver"); // Mon
    expect(new Date(before).toISOString()).toBe("2025-03-08T16:00:00.000Z");
    expect(new Date(after).toISOString()).toBe("2025-03-10T15:00:00.000Z");
  });
});

describe("tz — addDaysInTz", () => {
  test("adding 1 day across spring forward keeps wall time stable", () => {
    // 2025-03-08 09:00 Denver
    const start = wallTimeToUtc(2025, 2, 8, 9 * 3_600_000, "America/Denver");
    const next = addDaysInTz(start, 1, "America/Denver");
    const w = utcToWallParts(next, "America/Denver");
    expect({ year: w.year, month: w.month, day: w.day, hour: w.hour }).toEqual({
      year: 2025,
      month: 2,
      day: 9,
      hour: 9,
    });
    // The actual elapsed UTC ms is 23 hours, not 24.
    expect(next - start).toBe(23 * 3_600_000);
  });

  test("adding 1 day across fall back keeps wall time stable", () => {
    const start = wallTimeToUtc(2025, 10, 1, 9 * 3_600_000, "America/Denver");
    const next = addDaysInTz(start, 1, "America/Denver");
    const w = utcToWallParts(next, "America/Denver");
    expect({ year: w.year, month: w.month, day: w.day, hour: w.hour }).toEqual({
      year: 2025,
      month: 10,
      day: 2,
      hour: 9,
    });
    // 25-hour day.
    expect(next - start).toBe(25 * 3_600_000);
  });

  test("adding negative days works", () => {
    const start = wallTimeToUtc(2026, 4, 11, 12 * 3_600_000, "UTC");
    const before = addDaysInTz(start, -10, "UTC");
    expect(new Date(before).toISOString()).toBe("2026-05-01T12:00:00.000Z");
  });
});

describe("tz — addMonthsInTz", () => {
  test("adds months in wall sense", () => {
    const start = wallTimeToUtc(2026, 0, 31, 12 * 3_600_000, "UTC"); // Jan 31
    const next = addMonthsInTz(start, 1, "UTC"); // Feb 31 → Mar 3 (JS rolls over)
    const w = utcToWallParts(next, "UTC");
    expect({ year: w.year, month: w.month, day: w.day }).toEqual({
      year: 2026,
      month: 2, // March (JS rolls Feb 31 → Mar 3)
      day: 3,
    });
  });
});

describe("tz — dayOfWeekInTz", () => {
  test("crosses date boundary correctly in non-UTC tz", () => {
    // 2026-05-11 23:00 UTC = 2026-05-11 16:00 PDT (Monday in LA, Monday in UTC)
    const utc = Date.UTC(2026, 4, 11, 23, 0, 0);
    expect(dayOfWeekInTz(utc, "UTC")).toBe(Day.Monday);
    expect(dayOfWeekInTz(utc, "America/Los_Angeles")).toBe(Day.Monday);
  });

  test("date boundary case: 04:00 UTC Tuesday is still Monday in LA", () => {
    // 2026-05-12 04:00 UTC = 2026-05-11 21:00 PDT
    const utc = Date.UTC(2026, 4, 12, 4, 0, 0);
    expect(dayOfWeekInTz(utc, "UTC")).toBe(Day.Tuesday);
    expect(dayOfWeekInTz(utc, "America/Los_Angeles")).toBe(Day.Monday);
  });
});

describe("tz — monthLength", () => {
  test("returns civil month length", () => {
    expect(monthLength(2024, 1)).toBe(29); // Feb 2024 (leap)
    expect(monthLength(2025, 1)).toBe(28); // Feb 2025
    expect(monthLength(2026, 0)).toBe(31); // Jan
    expect(monthLength(2026, 3)).toBe(30); // Apr
  });
});
