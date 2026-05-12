import type { AnchoredRule } from "../types";
import { computeSpanEnd } from "../tz";
import {
  MAX_OCCURRENCES_PER_GENERATE,
  type Occurrence,
  TooManyOccurrencesError,
  intersects,
} from "./types";

// Anchored is tz-independent for STEPPING (every occurrence is exactly
// intervalMs ms from the anchor), but tz can still affect the end-of-
// occurrence when hourSpan is used. seriesStart/seriesEnd bound in UTC.
export function generateAnchored(
  rule: AnchoredRule,
  tz: string | undefined,
  windowStart: number,
  windowEnd: number
): Occurrence[] {
  if (rule.intervalMs <= 0) {
    throw new Error(`AnchoredRule.intervalMs must be > 0 (got ${rule.intervalMs})`);
  }
  if (rule.count != null && rule.count < 0) {
    throw new Error(`AnchoredRule.count must be >= 0 (got ${rule.count})`);
  }

  const seriesEnd = rule.seriesEnd ?? Number.POSITIVE_INFINITY;
  const effectiveEnd = Math.min(windowEnd, seriesEnd);
  const effectiveStart = Math.max(windowStart, rule.seriesStart);

  if (effectiveStart >= effectiveEnd) return [];

  // If `count` is set we must start counting from the anchor; otherwise we
  // can fast-forward to the window start.
  let index: number;
  let occurrenceStart: number;
  if (rule.count != null) {
    index = 0;
    occurrenceStart = rule.anchorDate;
  } else {
    if (effectiveStart <= rule.anchorDate) {
      index = 0;
      occurrenceStart = rule.anchorDate;
    } else {
      // First occurrence at or after effectiveStart.
      const stepsAhead = Math.ceil((effectiveStart - rule.anchorDate) / rule.intervalMs);
      index = stepsAhead;
      occurrenceStart = rule.anchorDate + stepsAhead * rule.intervalMs;
    }
  }

  const out: Occurrence[] = [];
  while (occurrenceStart < effectiveEnd) {
    if (rule.count != null && index >= rule.count) break;

    const occEnd = computeSpanEnd(occurrenceStart, rule.timeSpan, tz);
    if (
      intersects(occurrenceStart, occEnd, windowStart, windowEnd) &&
      occurrenceStart >= rule.seriesStart
    ) {
      out.push({ startTimestamp: occurrenceStart, endTimestamp: occEnd });
      if (out.length > MAX_OCCURRENCES_PER_GENERATE) {
        throw new TooManyOccurrencesError("anchored");
      }
    }
    index++;
    occurrenceStart += rule.intervalMs;
  }
  return out;
}
