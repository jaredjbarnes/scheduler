import type { InstantRule } from "../types";
import { computeSpanEnd } from "../tz";
import { type Occurrence, intersects } from "./types";

// A single occurrence at an absolute UTC instant. The template timezone does
// not affect the start (the instant is already a fixed point on the timeline);
// it only flexes an hourSpan end, via computeSpanEnd.
export function generateInstant(
  rule: InstantRule,
  tz: string | undefined,
  windowStart: number,
  windowEnd: number
): Occurrence[] {
  const start = rule.startOn;
  const end = computeSpanEnd(start, rule.timeSpan, tz);
  if (!intersects(start, end, windowStart, windowEnd)) return [];
  return [{ startTimestamp: start, endTimestamp: end }];
}
