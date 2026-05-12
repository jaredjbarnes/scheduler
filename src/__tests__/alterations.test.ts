import { describe, expect, test } from "vitest";
import { applyAlterations } from "../alterations";
import { type KeyedOccurrence, assignOccurrenceKeys } from "../occurrence_key";
import type { Alteration } from "../types";

interface CronPayload {
  type: "cron";
  command: string;
}

const HOUR = 3_600_000;
const TPL_ID = "tpl-1";
const PAYLOAD: CronPayload = { type: "cron", command: "ls" };

function keyed(starts: number[], duration: number): KeyedOccurrence[] {
  return assignOccurrenceKeys(
    starts.map((s) => ({ startTimestamp: s, endTimestamp: s + duration })),
    "UTC"
  );
}

describe("assignOccurrenceKeys", () => {
  test("YYYY-MM-DD when one per day", () => {
    const k = keyed([Date.UTC(2026, 4, 11, 9), Date.UTC(2026, 4, 12, 9)], HOUR);
    expect(k.map((o) => o.occurrenceKey)).toEqual(["2026-05-11", "2026-05-12"]);
  });

  test("YYYY-MM-DD#N when multiple per day", () => {
    const k = keyed(
      [Date.UTC(2026, 4, 11, 9), Date.UTC(2026, 4, 11, 15), Date.UTC(2026, 4, 11, 21)],
      HOUR
    );
    expect(k.map((o) => o.occurrenceKey)).toEqual(["2026-05-11", "2026-05-11#1", "2026-05-11#2"]);
  });

  test("respects tz when bucketing", () => {
    // 2026-05-12T03:00Z is May 11 21:00 in America/Denver (MDT, -06)
    const k = assignOccurrenceKeys(
      [
        { startTimestamp: Date.UTC(2026, 4, 11, 21), endTimestamp: 0 }, // 15:00 Denver = May 11
        { startTimestamp: Date.UTC(2026, 4, 12, 3), endTimestamp: 0 }, // 21:00 Denver = May 11
      ],
      "America/Denver"
    );
    expect(k.map((o) => o.occurrenceKey)).toEqual(["2026-05-11", "2026-05-11#1"]);
  });
});

describe("applyAlterations", () => {
  const winStart = Date.UTC(2026, 4, 11);
  const winEnd = Date.UTC(2026, 4, 14);
  const occs = keyed(
    [
      Date.UTC(2026, 4, 11, 9), // key 2026-05-11
      Date.UTC(2026, 4, 12, 9), // key 2026-05-12
      Date.UTC(2026, 4, 13, 9), // key 2026-05-13
    ],
    HOUR
  );

  test("no alterations: emits all base occurrences", () => {
    const out = applyAlterations(TPL_ID, PAYLOAD, occs, [], "UTC", winStart, winEnd);
    expect(out).toHaveLength(3);
    expect(out.every((o) => o.alterationId == null)).toBe(true);
  });

  test("cancel suppresses the matched occurrence", () => {
    const alt: Alteration<CronPayload> = {
      id: "a1",
      templateId: TPL_ID,
      occurrenceKey: "2026-05-12",
      kind: "cancel",
    };
    const out = applyAlterations(TPL_ID, PAYLOAD, occs, [alt], "UTC", winStart, winEnd);
    expect(out).toHaveLength(2);
    expect(out.map((o) => o.occurrenceKey)).toEqual(["2026-05-11", "2026-05-13"]);
  });

  test("reschedule shifts the time and tags alterationId", () => {
    const newStart = Date.UTC(2026, 4, 12, 17);
    const alt: Alteration<CronPayload> = {
      id: "a1",
      templateId: TPL_ID,
      occurrenceKey: "2026-05-12",
      kind: "reschedule",
      startTimestamp: newStart,
      timeSpan: { type: "duration", ms: 2 * HOUR },
    };
    const out = applyAlterations(TPL_ID, PAYLOAD, occs, [alt], "UTC", winStart, winEnd);
    const moved = out.find((o) => o.occurrenceKey === "2026-05-12");
    expect(moved?.startTimestamp).toBe(newStart);
    expect(moved?.endTimestamp).toBe(newStart + 2 * HOUR);
    expect(moved?.alterationId).toBe("a1");
  });

  test("reschedule without timeSpan inherits original duration", () => {
    const newStart = Date.UTC(2026, 4, 12, 17);
    const alt: Alteration<CronPayload> = {
      id: "a1",
      templateId: TPL_ID,
      occurrenceKey: "2026-05-12",
      kind: "reschedule",
      startTimestamp: newStart,
      // no timeSpan → inherits original UTC duration (1 hour)
    };
    const out = applyAlterations(TPL_ID, PAYLOAD, occs, [alt], "UTC", winStart, winEnd);
    const moved = out.find((o) => o.occurrenceKey === "2026-05-12");
    expect(moved?.endTimestamp).toBe(newStart + HOUR);
  });

  test("payloadOverride merges into base payload", () => {
    const alt: Alteration<CronPayload> = {
      id: "a1",
      templateId: TPL_ID,
      occurrenceKey: "2026-05-12",
      kind: "reschedule",
      startTimestamp: Date.UTC(2026, 4, 12, 9), // same time
      timeSpan: { type: "duration", ms: HOUR },
      payloadOverride: { command: "echo override" },
    };
    const out = applyAlterations(TPL_ID, PAYLOAD, occs, [alt], "UTC", winStart, winEnd);
    const moved = out.find((o) => o.occurrenceKey === "2026-05-12");
    expect(moved?.payload).toEqual({ type: "cron", command: "echo override" });
  });

  test("reschedule that moves event out of window is not emitted", () => {
    const alt: Alteration<CronPayload> = {
      id: "a1",
      templateId: TPL_ID,
      occurrenceKey: "2026-05-12",
      kind: "reschedule",
      startTimestamp: Date.UTC(2026, 5, 1), // out of window
      timeSpan: { type: "duration", ms: HOUR },
    };
    const out = applyAlterations(TPL_ID, PAYLOAD, occs, [alt], "UTC", winStart, winEnd);
    expect(out.map((o) => o.occurrenceKey)).toEqual(["2026-05-11", "2026-05-13"]);
  });

  test("orphan reschedule (original outside window, new time inside) is emitted", () => {
    const alt: Alteration<CronPayload> = {
      id: "orphan",
      templateId: TPL_ID,
      occurrenceKey: "2026-05-01",
      kind: "reschedule",
      startTimestamp: Date.UTC(2026, 4, 12, 13),
      timeSpan: { type: "duration", ms: HOUR },
    };
    const out = applyAlterations(TPL_ID, PAYLOAD, occs, [alt], "UTC", winStart, winEnd);
    expect(out.find((o) => o.alterationId === "orphan")).toBeDefined();
    expect(out).toHaveLength(4); // 3 base + 1 orphan
  });

  test("alterations for other templates are ignored", () => {
    const alt: Alteration<CronPayload> = {
      id: "wrong",
      templateId: "other-template",
      occurrenceKey: "2026-05-12",
      kind: "cancel",
    };
    const out = applyAlterations(TPL_ID, PAYLOAD, occs, [alt], "UTC", winStart, winEnd);
    expect(out).toHaveLength(3);
  });

  test("output is sorted ascending by startTimestamp", () => {
    const alt: Alteration<CronPayload> = {
      id: "a1",
      templateId: TPL_ID,
      occurrenceKey: "2026-05-11",
      kind: "reschedule",
      startTimestamp: Date.UTC(2026, 4, 13, 18), // move the 11th to after the 13th
      timeSpan: { type: "duration", ms: HOUR },
    };
    const out = applyAlterations(TPL_ID, PAYLOAD, occs, [alt], "UTC", winStart, winEnd);
    const starts = out.map((o) => o.startTimestamp);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
