import { describe, expect, test } from "vitest";
import { generateAnchored } from "../generators/anchored.js";
import type { AnchoredRule } from "../types.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("generateAnchored", () => {
  test("emits occurrences at intervalMs from anchor within window", () => {
    const rule: AnchoredRule = {
      kind: "anchored",
      anchorDate: Date.UTC(2026, 4, 11, 9, 0, 0),
      intervalMs: 6 * HOUR,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 4, 11),
      seriesEnd: null,
    };
    const out = generateAnchored(rule, undefined, Date.UTC(2026, 4, 11), Date.UTC(2026, 4, 12));
    // Anchor 09:00 + 6h steps = 09, 15, 21 on the 11th (3 events)
    expect(out.map((o) => new Date(o.startTimestamp).toISOString())).toEqual([
      "2026-05-11T09:00:00.000Z",
      "2026-05-11T15:00:00.000Z",
      "2026-05-11T21:00:00.000Z",
    ]);
  });

  test("fast-forwards into the future without count", () => {
    const rule: AnchoredRule = {
      kind: "anchored",
      anchorDate: Date.UTC(2020, 0, 1),
      intervalMs: DAY,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2020, 0, 1),
      seriesEnd: null,
    };
    const out = generateAnchored(rule, undefined, Date.UTC(2026, 4, 11), Date.UTC(2026, 4, 14));
    // 3 days in window, daily cadence, anchor far in the past → 3 events
    expect(out).toHaveLength(3);
    expect(new Date(out[0].startTimestamp).toISOString()).toBe("2026-05-11T00:00:00.000Z");
  });

  test("respects count and counts from anchor (not from window start)", () => {
    const rule: AnchoredRule = {
      kind: "anchored",
      anchorDate: Date.UTC(2026, 4, 11),
      intervalMs: DAY,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 4, 11),
      seriesEnd: null,
      count: 3,
    };
    // Window covers many days, but count=3 caps at 3 events
    const out = generateAnchored(rule, undefined, Date.UTC(2026, 4, 11), Date.UTC(2026, 4, 30));
    expect(out).toHaveLength(3);
  });

  test("count=3 with window after the 3rd event → empty", () => {
    const rule: AnchoredRule = {
      kind: "anchored",
      anchorDate: Date.UTC(2026, 4, 11),
      intervalMs: DAY,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 4, 11),
      seriesEnd: null,
      count: 3,
    };
    const out = generateAnchored(rule, undefined, Date.UTC(2026, 4, 20), Date.UTC(2026, 4, 30));
    expect(out).toHaveLength(0);
  });

  test("respects seriesEnd as exclusive bound", () => {
    const rule: AnchoredRule = {
      kind: "anchored",
      anchorDate: Date.UTC(2026, 4, 11),
      intervalMs: DAY,
      timeSpan: { type: "duration", ms: HOUR },
      seriesStart: Date.UTC(2026, 4, 11),
      seriesEnd: Date.UTC(2026, 4, 14), // 11, 12, 13 should emit; 14 should not
    };
    const out = generateAnchored(rule, undefined, Date.UTC(2026, 4, 11), Date.UTC(2026, 4, 30));
    expect(out).toHaveLength(3);
  });

  test("throws on intervalMs <= 0 (no infinite loop)", () => {
    const rule: AnchoredRule = {
      kind: "anchored",
      anchorDate: 0,
      intervalMs: 0,
      seriesStart: 0,
      seriesEnd: null,
    };
    expect(() => generateAnchored(rule, undefined, 0, 1000)).toThrow(/intervalMs/);
  });

  test("throws on too many occurrences", () => {
    const rule: AnchoredRule = {
      kind: "anchored",
      anchorDate: 0,
      intervalMs: 1, // every ms
      timeSpan: { type: "duration", ms: 1 }, // non-zero so half-open intersection emits
      seriesStart: 0,
      seriesEnd: null,
    };
    // Window is 100k ms, no count → would emit 100k events. Should throw.
    expect(() => generateAnchored(rule, undefined, 0, 100_000)).toThrow(/more than/);
  });
});
