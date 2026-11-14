import type { DaysOfYearRule, Disambiguation } from "../types.js";
import { computeSpanEnd, isNonexistentWallTime, utcToWallParts, wallTimeToUtc } from "../tz.js";
import {
  MAX_OCCURRENCES_PER_GENERATE,
  type Occurrence,
  TooManyOccurrencesError,
  intersects,
} from "./types.js";

// Day-of-year recurrence. Day 1 = Jan 1. Day 366 only exists in leap
// years and is SKIPPED in non-leap years (no clamp — "366th day" means
// literally that).
export function generateDaysOfYear(
  rule: DaysOfYearRule,
  tz: string | undefined,
  windowStart: number,
  windowEnd: number,
  disambiguation: Disambiguation = "compatible"
): Occurrence[] {
  if (rule.yearInterval <= 0) {
    throw new Error(`DaysOfYearRule.yearInterval must be > 0 (got ${rule.yearInterval})`);
  }
  if (rule.daysOfYear.length === 0) {
    throw new Error("DaysOfYearRule.daysOfYear must be non-empty");
  }
  for (const d of rule.daysOfYear) {
    if (d < 1 || d > 366) {
      throw new Error(`DaysOfYearRule.daysOfYear entries must be in 1..366 (got ${d})`);
    }
  }
  if (rule.count != null && rule.count < 0) {
    throw new Error(`DaysOfYearRule.count must be >= 0 (got ${rule.count})`);
  }

  const seriesEnd = rule.seriesEnd ?? Number.POSITIVE_INFINITY;
  const effectiveEnd = Math.min(windowEnd, seriesEnd);
  if (rule.seriesStart >= effectiveEnd) return [];

  const days = [...new Set(rule.daysOfYear)].sort((a, b) => a - b);

  const startYear = utcToWallParts(rule.seriesStart, tz).year;
  const endYear = utcToWallParts(Math.min(effectiveEnd, Number.MAX_SAFE_INTEGER), tz).year;

  const out: Occurrence[] = [];
  let count = 0;

  for (let year = startYear; year <= endYear; year += rule.yearInterval) {
    const yearEmits: Occurrence[] = [];

    for (const dayOfYear of days) {
      // Date.UTC(year, 0, N) treats N as "Nth day from Jan 1". If N is 366
      // in a non-leap year it rolls into year+1; detect and skip.
      const probe = new Date(Date.UTC(year, 0, dayOfYear));
      if (probe.getUTCFullYear() !== year) continue; // day 366 in non-leap year

      const month = probe.getUTCMonth();
      const day = probe.getUTCDate();
      if (
        disambiguation === "skip" &&
        isNonexistentWallTime(year, month, day, rule.timeOfDay, tz)
      ) {
        continue;
      }
      const occStart = wallTimeToUtc(year, month, day, rule.timeOfDay, tz, disambiguation);
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
          throw new TooManyOccurrencesError("daysOfYear");
        }
      }
    }
    yearEmits.sort((a, b) => a.startTimestamp - b.startTimestamp);
    out.push(...yearEmits);
  }
  return out;
}
