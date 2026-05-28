import type { Disambiguation, YearlyRule } from "../types";
import {
  computeSpanEnd,
  isNonexistentWallTime,
  monthLength,
  utcToWallParts,
  wallTimeToUtc,
} from "../tz";
import {
  MAX_OCCURRENCES_PER_GENERATE,
  type Occurrence,
  TooManyOccurrencesError,
  intersects,
} from "./types";

// Simple yearly recurrence: a single month + day. Day clamps to month
// length (Feb 29 → Feb 28 in non-leap years, Apr 31 → Apr 30, etc.).
export function generateYearly(
  rule: YearlyRule,
  tz: string | undefined,
  windowStart: number,
  windowEnd: number,
  disambiguation: Disambiguation = "compatible"
): Occurrence[] {
  if (rule.yearInterval <= 0) {
    throw new Error(`YearlyRule.yearInterval must be > 0 (got ${rule.yearInterval})`);
  }
  if (rule.month < 0 || rule.month > 11) {
    throw new Error(`YearlyRule.month must be in 0..11 (got ${rule.month})`);
  }
  if (rule.day < 1 || rule.day > 31) {
    throw new Error(`YearlyRule.day must be in 1..31 (got ${rule.day})`);
  }
  if (rule.count != null && rule.count < 0) {
    throw new Error(`YearlyRule.count must be >= 0 (got ${rule.count})`);
  }

  const seriesEnd = rule.seriesEnd ?? Number.POSITIVE_INFINITY;
  const effectiveEnd = Math.min(windowEnd, seriesEnd);
  if (rule.seriesStart >= effectiveEnd) return [];

  const startYear = utcToWallParts(rule.seriesStart, tz).year;
  const endYear = utcToWallParts(Math.min(effectiveEnd, Number.MAX_SAFE_INTEGER), tz).year;

  const out: Occurrence[] = [];
  let count = 0;

  for (let year = startYear; year <= endYear; year += rule.yearInterval) {
    const day = Math.min(rule.day, monthLength(year, rule.month));
    if (
      disambiguation === "skip" &&
      isNonexistentWallTime(year, rule.month, day, rule.timeOfDay, tz)
    ) {
      continue;
    }
    const occStart = wallTimeToUtc(year, rule.month, day, rule.timeOfDay, tz, disambiguation);
    const occEnd = computeSpanEnd(occStart, rule.timeSpan, tz);

    if (occStart < rule.seriesStart) continue;
    if (occStart >= seriesEnd) continue;

    if (rule.count != null && count >= rule.count) break;
    count++;

    if (intersects(occStart, occEnd, windowStart, windowEnd)) {
      out.push({ startTimestamp: occStart, endTimestamp: occEnd });
      if (out.length > MAX_OCCURRENCES_PER_GENERATE) {
        throw new TooManyOccurrencesError("yearly");
      }
    }
  }
  return out;
}
