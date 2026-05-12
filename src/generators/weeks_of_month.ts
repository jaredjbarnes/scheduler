import type { WeeksOfMonthRule } from "../types";
import { addMonthsInTz, computeSpanEnd, monthLength, utcToWallParts, wallTimeToUtc } from "../tz";
import {
  MAX_OCCURRENCES_PER_GENERATE,
  type Occurrence,
  TooManyOccurrencesError,
  intersects,
} from "./types";

// "Nth Tuesday of every month", "last Friday of every other month", etc.
// Iterate month-by-month at monthInterval cadence; for each repeatable day,
// resolve the target wall date.
export function generateWeeksOfMonth(
  rule: WeeksOfMonthRule,
  tz: string | undefined,
  windowStart: number,
  windowEnd: number
): Occurrence[] {
  if (rule.monthInterval <= 0) {
    throw new Error(`WeeksOfMonthRule.monthInterval must be > 0 (got ${rule.monthInterval})`);
  }
  if (rule.weeks.length === 0) {
    throw new Error("WeeksOfMonthRule.weeks must be non-empty");
  }
  for (const w of rule.weeks) {
    if (w === 0 || w < -5 || w > 5) {
      throw new Error(`WeeksOfMonthRule.weeks entries must be in [-5..-1] or [1..5] (got ${w})`);
    }
  }
  if (rule.days.length === 0) {
    throw new Error("WeeksOfMonthRule.days must be non-empty");
  }
  if (rule.count != null && rule.count < 0) {
    throw new Error(`WeeksOfMonthRule.count must be >= 0 (got ${rule.count})`);
  }

  const seriesEnd = rule.seriesEnd ?? Number.POSITIVE_INFINITY;
  const effectiveEnd = Math.min(windowEnd, seriesEnd);
  if (rule.seriesStart >= effectiveEnd) return [];

  const days = [...rule.days].sort((a, b) => a - b);
  // Dedup `weeks` so a duplicated entry doesn't double-emit. Don't sort —
  // we sort the per-month emits at the end of each month iteration anyway.
  const weeks = [...new Set(rule.weeks)];

  // Anchor at seriesStart's month (in tz).
  const seriesStartParts = utcToWallParts(rule.seriesStart, tz);
  let monthAnchor = wallTimeToUtc(seriesStartParts.year, seriesStartParts.month, 1, 0, tz);

  const out: Occurrence[] = [];
  let count = 0;

  while (monthAnchor < effectiveEnd) {
    const mp = utcToWallParts(monthAnchor, tz);
    const monthEmits: Occurrence[] = [];

    for (const week of weeks) {
      for (const dow of days) {
        const targetDay = _nthWeekdayOfMonth(mp.year, mp.month, dow, week);
        if (targetDay == null) continue; // e.g. 5th Friday in a 4-Friday month

        const occStart = wallTimeToUtc(mp.year, mp.month, targetDay, rule.timeOfDay, tz);
        const occEnd = computeSpanEnd(occStart, rule.timeSpan, tz);

        if (occStart < rule.seriesStart) continue;
        if (occStart >= seriesEnd) continue;

        if (rule.count != null && count >= rule.count) {
          // Sort and emit what we collected this month before returning.
          monthEmits.sort((a, b) => a.startTimestamp - b.startTimestamp);
          out.push(...monthEmits);
          return out;
        }
        count++;

        if (intersects(occStart, occEnd, windowStart, windowEnd)) {
          monthEmits.push({ startTimestamp: occStart, endTimestamp: occEnd });
          if (out.length + monthEmits.length > MAX_OCCURRENCES_PER_GENERATE) {
            throw new TooManyOccurrencesError("weeksOfMonth");
          }
        }
      }
    }
    // Sort within-month emits before appending. With multiple weeks (and
    // negative weeks mixed with positive), per-week iteration order doesn't
    // produce ascending startTimestamps.
    monthEmits.sort((a, b) => a.startTimestamp - b.startTimestamp);
    out.push(...monthEmits);
    monthAnchor = addMonthsInTz(monthAnchor, rule.monthInterval, tz);
  }
  return out;
}

// Returns the day-of-month (1..31) for the Nth weekday of the given month,
// or null if it doesn't exist (e.g. asking for the 5th Tuesday of a 4-Tuesday
// month). Negative N counts from the end: -1 = last, -2 = second-to-last.
function _nthWeekdayOfMonth(year: number, month: number, dow: number, n: number): number | null {
  const len = monthLength(year, month);

  if (n > 0) {
    // Find the first occurrence of `dow` in the month, then step by 7s.
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const offset = (dow - firstDow + 7) % 7;
    const day = 1 + offset + (n - 1) * 7;
    return day <= len ? day : null;
  }
  // n < 0: count from end of month.
  const lastDow = new Date(Date.UTC(year, month, len)).getUTCDay();
  const offset = (lastDow - dow + 7) % 7;
  const day = len - offset + (n + 1) * 7;
  return day >= 1 ? day : null;
}
