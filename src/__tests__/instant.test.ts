import { describe, expect, test } from "vitest";
import { generateInstant } from "../generators/instant";
import type { InstantRule } from "../types";

describe("generateInstant", () => {
  const rule: InstantRule = {
    kind: "instant",
    startOn: Date.UTC(2026, 4, 11, 14, 0, 0),
    timeSpan: { type: "duration", ms: 60 * 60_000 },
  };

  test("emits if event intersects window", () => {
    const out = generateInstant(rule, undefined, Date.UTC(2026, 4, 11), Date.UTC(2026, 4, 12));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      startTimestamp: rule.startOn,
      endTimestamp: rule.startOn + 60 * 60_000,
    });
  });

  test("emits if window is entirely inside event duration", () => {
    const out = generateInstant(
      rule,
      undefined,
      rule.startOn + 10 * 60_000,
      rule.startOn + 20 * 60_000
    );
    expect(out).toHaveLength(1);
  });

  test("does not emit when window is fully before", () => {
    const out = generateInstant(rule, undefined, Date.UTC(2026, 4, 1), Date.UTC(2026, 4, 10));
    expect(out).toHaveLength(0);
  });

  test("does not emit when window is fully after", () => {
    const out = generateInstant(rule, undefined, Date.UTC(2026, 4, 20), Date.UTC(2026, 4, 25));
    expect(out).toHaveLength(0);
  });

  test("does not emit when window is exactly the end (half-open)", () => {
    const out = generateInstant(
      rule,
      undefined,
      rule.startOn + 60 * 60_000,
      rule.startOn + 60 * 60_000 + 1000
    );
    expect(out).toHaveLength(0);
  });
});
