import type { DaysOfWeekRule, Disambiguation } from "../types";
import {
  addDaysInTz,
  computeSpanEnd,
  dayOfWeekInTz,
  isNonexistentWallTime,
  utcToWallParts,
  wallTimeToUtc,
} from "../tz";
import {
  MAX_OCCURRENCES_PER_GENERATE,
  type Occurrence,
  TooManyOccurrencesError,
  intersects,
} from "./types";

// Iterate week-by-week (in wall time, in tz) starting from seriesStart's
// week. For each scheduled week, emit the occurrences that fall on the
// rule's days.
export function generateDaysOfWeek(
  rule: DaysOfWeekRule,
  tz: string | undefined,
  windowStart: number,
  windowEnd: number,
  disambiguation: Disambiguation = "compatible"
): Occurrence[] {
  if (rule.weekInterval <= 0) {
    throw new Error(`DaysOfWeekRule.weekInterval must be > 0 (got ${rule.weekInterval})`);
  }
  if (rule.days.length === 0) {
    throw new Error("DaysOfWeekRule.days must be non-empty");
  }
  if (rule.count != null && rule.count < 0) {
    throw new Error(`DaysOfWeekRule.count must be >= 0 (got ${rule.count})`);
  }

  const seriesEnd = rule.seriesEnd ?? Number.POSITIVE_INFINITY;
  const effectiveEnd = Math.min(windowEnd, seriesEnd);
  if (rule.seriesStart >= effectiveEnd) return [];

  // Sort days for deterministic emit order within a week.
  const days = [...rule.days].sort((a, b) => a - b);

  // Anchor: snap seriesStart to the start of its week (Sunday) in tz.
  const seriesStartParts = utcToWallParts(rule.seriesStart, tz);
  const daysSinceSunday = seriesStartParts.dayOfWeek;
  const weekAnchor = wallTimeToUtc(
    seriesStartParts.year,
    seriesStartParts.month,
    seriesStartParts.day - daysSinceSunday,
    0,
    tz
  );

  const out: Occurrence[] = [];
  let count = 0;
  // Step by `weekInterval` weeks at a time. Use addDaysInTz to handle DST
  // correctly (a week is 7 calendar days, not 7*86400000 ms).
  let weekStart = weekAnchor;
  while (weekStart < effectiveEnd) {
    for (const dow of days) {
      // Compute the day-of-week within this week in tz wall time.
      const dayUtc = addDaysInTz(weekStart, dow, tz);
      const dayParts = utcToWallParts(dayUtc, tz);
      if (
        disambiguation === "skip" &&
        isNonexistentWallTime(dayParts.year, dayParts.month, dayParts.day, rule.timeOfDay, tz)
      ) {
        continue;
      }
      const occStart = wallTimeToUtc(
        dayParts.year,
        dayParts.month,
        dayParts.day,
        rule.timeOfDay,
        tz,
        disambiguation
      );
      const occEnd = computeSpanEnd(occStart, rule.timeSpan, tz);

      // Must be on/after seriesStart and before seriesEnd.
      if (occStart < rule.seriesStart) continue;
      if (occStart >= seriesEnd) continue;

      if (rule.count != null && count >= rule.count) return out;
      count++;

      if (intersects(occStart, occEnd, windowStart, windowEnd)) {
        out.push({ startTimestamp: occStart, endTimestamp: occEnd });
        if (out.length > MAX_OCCURRENCES_PER_GENERATE) {
          throw new TooManyOccurrencesError("daysOfWeek");
        }
      }
    }
    weekStart = addDaysInTz(weekStart, 7 * rule.weekInterval, tz);
  }
  return out;
}

// Re-export so consumers can sanity-check the rule's first day in tz.
export { dayOfWeekInTz };
