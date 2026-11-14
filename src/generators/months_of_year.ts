import type { Disambiguation, MonthsOfYearRule } from "../types.js";
import {
  addMonthsInTz,
  computeSpanEnd,
  isNonexistentWallTime,
  monthLength,
  utcToWallParts,
  wallTimeToUtc,
} from "../tz.js";
import {
  MAX_OCCURRENCES_PER_GENERATE,
  type Occurrence,
  TooManyOccurrencesError,
  intersects,
} from "./types.js";

// Positional yearly recurrence — top of the positional cascade.
// (months × weeks-of-month × weekdays, with yearInterval as cadence.)
//
// For each year in cadence, walk the selected months; in each month, find
// the Nth weekday matches (e.g. "2nd Tuesday") for each (week, day) pair.
// If a position doesn't exist that month (e.g. 5th Sunday in a 4-Sunday
// month), silently skip — same policy as WeeksOfMonthRule.
export function generateMonthsOfYear(
  rule: MonthsOfYearRule,
  tz: string | undefined,
  windowStart: number,
  windowEnd: number,
  disambiguation: Disambiguation = "compatible"
): Occurrence[] {
  if (rule.yearInterval <= 0) {
    throw new Error(`MonthsOfYearRule.yearInterval must be > 0 (got ${rule.yearInterval})`);
  }
  if (rule.months.length === 0) {
    throw new Error("MonthsOfYearRule.months must be non-empty");
  }
  for (const m of rule.months) {
    if (m < 0 || m > 11) {
      throw new Error(`MonthsOfYearRule.months entries must be in 0..11 (got ${m})`);
    }
  }
  if (rule.weeks.length === 0) {
    throw new Error("MonthsOfYearRule.weeks must be non-empty");
  }
  for (const w of rule.weeks) {
    if (w === 0 || w < -5 || w > 5) {
      throw new Error(`MonthsOfYearRule.weeks entries must be in [-5..-1] or [1..5] (got ${w})`);
    }
  }
  if (rule.days.length === 0) {
    throw new Error("MonthsOfYearRule.days must be non-empty");
  }
  if (rule.count != null && rule.count < 0) {
    throw new Error(`MonthsOfYearRule.count must be >= 0 (got ${rule.count})`);
  }

  const seriesEnd = rule.seriesEnd ?? Number.POSITIVE_INFINITY;
  const effectiveEnd = Math.min(windowEnd, seriesEnd);
  if (rule.seriesStart >= effectiveEnd) return [];

  const months = [...new Set(rule.months)].sort((a, b) => a - b);
  const weeks = [...new Set(rule.weeks)];
  const weekdays = [...new Set(rule.days)].sort((a, b) => a - b);

  // Anchor at the start of seriesStart's year (in tz), but actually anchor
  // at its first selected month within that year. We iterate year-by-year.
  const seriesStartParts = utcToWallParts(rule.seriesStart, tz);
  let yearAnchor = wallTimeToUtc(seriesStartParts.year, 0, 1, 0, tz);

  const out: Occurrence[] = [];
  let count = 0;

  while (yearAnchor < effectiveEnd) {
    const yp = utcToWallParts(yearAnchor, tz);
    const yearEmits: Occurrence[] = [];

    for (const month of months) {
      for (const week of weeks) {
        for (const dow of weekdays) {
          const targetDay = _nthWeekdayOfMonth(yp.year, month, dow, week);
          if (targetDay == null) continue; // Nth doesn't exist this month

          if (
            disambiguation === "skip" &&
            isNonexistentWallTime(yp.year, month, targetDay, rule.timeOfDay, tz)
          ) {
            continue;
          }
          const occStart = wallTimeToUtc(
            yp.year,
            month,
            targetDay,
            rule.timeOfDay,
            tz,
            disambiguation
          );
          const occEnd = computeSpanEnd(occStart, rule.timeSpan, tz);

          if (occStart < rule.seriesStart) continue;
          if (occStart >= seriesEnd) continue;

          if (rule.count != null && count >= rule.count) {
            yearEmits.sort((a, b) => a.startTimestamp - b.startTimestamp);
            out.push(...yearEmits);
            return out;
          }
          count++;

          if (intersects(occStart, occEnd, windowStart, windowEnd)) {
            yearEmits.push({ startTimestamp: occStart, endTimestamp: occEnd });
            if (out.length + yearEmits.length > MAX_OCCURRENCES_PER_GENERATE) {
              throw new TooManyOccurrencesError("monthsOfYear");
            }
          }
        }
      }
    }
    yearEmits.sort((a, b) => a.startTimestamp - b.startTimestamp);
    out.push(...yearEmits);
    // Step yearInterval years. Use addMonthsInTz(12) so leap-year wall-clock
    // arithmetic is correct (it isn't strictly necessary at year granularity,
    // but matches the rest of the codebase).
    yearAnchor = addMonthsInTz(yearAnchor, 12 * rule.yearInterval, tz);
  }
  return out;
}

// Same helper as WeeksOfMonth uses. Returns day-of-month (1..31) for the
// Nth occurrence of `dow` in the given month, or null if it doesn't exist.
function _nthWeekdayOfMonth(year: number, month: number, dow: number, n: number): number | null {
  const len = monthLength(year, month);

  if (n > 0) {
    const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const offset = (dow - firstDow + 7) % 7;
    const day = 1 + offset + (n - 1) * 7;
    return day <= len ? day : null;
  }
  const lastDow = new Date(Date.UTC(year, month, len)).getUTCDay();
  const offset = (lastDow - dow + 7) % 7;
  const day = len - offset + (n + 1) * 7;
  return day >= 1 ? day : null;
}
