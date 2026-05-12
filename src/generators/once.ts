import type { OnceRule } from "../types";
import { computeSpanEnd } from "../tz";
import { type Occurrence, intersects } from "./types";

export function generateOnce(
  rule: OnceRule,
  tz: string | undefined,
  windowStart: number,
  windowEnd: number
): Occurrence[] {
  const start = rule.startOn;
  const end = computeSpanEnd(start, rule.timeSpan, tz);
  if (!intersects(start, end, windowStart, windowEnd)) return [];
  return [{ startTimestamp: start, endTimestamp: end }];
}
