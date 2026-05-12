import type { DaysOfMonthRule } from "../types";
import { computeSpanEnd, monthLength, utcToWallParts, wallTimeToUtc } from "../tz";
import {
  MAX_OCCURRENCES_PER_GENERATE,
  type Occurrence,
  TooManyOccurrencesError,
  intersects,
} from "./types";

// Numerical date-based recurrence: months × daysOfMonth. Days clamp per
// month (day 31 in April → Apr 30, day 29 in Feb non-leap → Feb 28).
export function generateDaysOfMonth(
  rule: DaysOfMonthRule,
  tz: string | undefined,
  windowStart: number,
  windowEnd: number
): Occurrence[] {
  if (rule.yearInterval <= 0) {
    throw new Error(`DaysOfMonthRule.yearInterval must be > 0 (got ${rule.yearInterval})`);
  }
  if (rule.months.length === 0) {
    throw new Error("DaysOfMonthRule.months must be non-empty");
  }
  for (const m of rule.months) {
    if (m < 0 || m > 11) {
      throw new Error(`DaysOfMonthRule.months entries must be in 0..11 (got ${m})`);
    }
  }
  if (rule.daysOfMonth.length === 0) {
    throw new Error("DaysOfMonthRule.daysOfMonth must be non-empty");
  }
  for (const d of rule.daysOfMonth) {
    if (d < 1 || d > 31) {
      throw new Error(`DaysOfMonthRule.daysOfMonth entries must be in 1..31 (got ${d})`);
    }
  }
  if (rule.count != null && rule.count < 0) {
    throw new Error(`DaysOfMonthRule.count must be >= 0 (got ${rule.count})`);
  }

  const seriesEnd = rule.seriesEnd ?? Number.POSITIVE_INFINITY;
  const effectiveEnd = Math.min(windowEnd, seriesEnd);
  if (rule.seriesStart >= effectiveEnd) return [];

  const months = [...new Set(rule.months)].sort((a, b) => a - b);
  const daysOfMonth = [...new Set(rule.daysOfMonth)].sort((a, b) => a - b);

  const startYear = utcToWallParts(rule.seriesStart, tz).year;
  const endYear = utcToWallParts(Math.min(effectiveEnd, Number.MAX_SAFE_INTEGER), tz).year;

  const out: Occurrence[] = [];
  let count = 0;

  for (let year = startYear; year <= endYear; year += rule.yearInterval) {
    const yearEmits: Occurrence[] = [];

    for (const month of months) {
      const len = monthLength(year, month);
      // Dedup clamped days so day-31 + day-30 in April don't both emit Apr 30.
      const clampedDays = [...new Set(daysOfMonth.map((d) => Math.min(d, len)))];
      for (const day of clampedDays) {
        const occStart = wallTimeToUtc(year, month, day, rule.timeOfDay, tz);
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
            throw new TooManyOccurrencesError("daysOfMonth");
          }
        }
      }
    }
    yearEmits.sort((a, b) => a.startTimestamp - b.startTimestamp);
    out.push(...yearEmits);
  }
  return out;
}
