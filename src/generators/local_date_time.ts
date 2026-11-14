import type { Disambiguation, LocalDateTimeRule } from "../types.js";
import { computeSpanEnd, isNonexistentWallTime, monthLength, wallTimeToUtc } from "../tz.js";
import { type Occurrence, intersects } from "./types.js";

// A single occurrence expressed in wall-clock terms, resolved through the
// template timezone (DST-aware). `day` clamps to the month length. When tz is
// undefined the wall-clock fields are interpreted as UTC. A spring-forward gap
// or fall-back overlap on the start is resolved per `disambiguation` (see
// tz.ts) — "skip" drops the occurrence entirely if its wall time doesn't exist.
export function generateLocalDateTime(
  rule: LocalDateTimeRule,
  tz: string | undefined,
  windowStart: number,
  windowEnd: number,
  disambiguation: Disambiguation = "compatible"
): Occurrence[] {
  if (!Number.isInteger(rule.year)) {
    throw new Error(`LocalDateTimeRule.year must be an integer (got ${rule.year})`);
  }
  if (rule.month < 0 || rule.month > 11) {
    throw new Error(`LocalDateTimeRule.month must be in 0..11 (got ${rule.month})`);
  }
  if (rule.day < 1 || rule.day > 31) {
    throw new Error(`LocalDateTimeRule.day must be in 1..31 (got ${rule.day})`);
  }

  const day = Math.min(rule.day, monthLength(rule.year, rule.month));
  if (
    disambiguation === "skip" &&
    isNonexistentWallTime(rule.year, rule.month, day, rule.timeOfDay, tz)
  ) {
    return [];
  }
  const start = wallTimeToUtc(rule.year, rule.month, day, rule.timeOfDay, tz, disambiguation);
  const end = computeSpanEnd(start, rule.timeSpan, tz);
  if (!intersects(start, end, windowStart, windowEnd)) return [];
  return [{ startTimestamp: start, endTimestamp: end }];
}
