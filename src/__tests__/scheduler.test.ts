import { describe, expect, test } from "vitest";
import { InMemorySchedulerPort } from "../in_memory_port.js";
import { Scheduler } from "../scheduler.js";
import { Day, type ScheduleTemplate } from "../types.js";

interface CronPayload {
  type: "cron";
  command: string;
}

const HOUR = 3_600_000;

function makeScheduler() {
  const port = new InMemorySchedulerPort<CronPayload>();
  const scheduler = new Scheduler(port);
  return { port, scheduler };
}

describe("Scheduler — list across mixed rule kinds", () => {
  test("emits events from once + daysOfWeek + yearly templates in one window", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "once-1",
      timezone: "UTC",
      rule: {
        kind: "instant",
        startOn: Date.UTC(2026, 4, 11, 14),
        timeSpan: { type: "duration", ms: HOUR },
      },
      payload: { type: "cron", command: "ping" },
    });
    await scheduler.add({
      id: "weekly-1",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday, Day.Wednesday, Day.Friday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "rsync" },
    });
    await scheduler.add({
      id: "yearly-1",
      timezone: "UTC",
      rule: {
        kind: "yearly",
        month: 4, // May
        day: 11,
        yearInterval: 1,
        timeOfDay: 0,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 0, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "yearly-task" },
    });

    const events = await scheduler.list(Date.UTC(2026, 4, 11), Date.UTC(2026, 4, 12));
    // Expect: yearly @ 00:00, weekly Mon @ 09:00, once @ 14:00
    expect(
      events.map((e) => `${e.payload.command}@${new Date(e.startTimestamp).toISOString()}`)
    ).toEqual([
      "yearly-task@2026-05-11T00:00:00.000Z",
      "rsync@2026-05-11T09:00:00.000Z",
      "ping@2026-05-11T14:00:00.000Z",
    ]);
  });
});

describe("Scheduler — alterations end-to-end", () => {
  test("cancel and reschedule on a daysOfWeek template", async () => {
    const { scheduler } = makeScheduler();
    const tpl: ScheduleTemplate<CronPayload> = {
      id: "weekly-1",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday, Day.Wednesday, Day.Friday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "rsync" },
    };
    await scheduler.add(tpl);

    // Cancel Wednesday, reschedule Friday to 14:00 with override command.
    await scheduler.cancel("weekly-1", "2026-05-06");
    await scheduler.reschedule(
      "weekly-1",
      "2026-05-08",
      Date.UTC(2026, 4, 8, 14),
      { type: "duration", ms: 2 * HOUR },
      { command: "rsync --verbose" }
    );

    const events = await scheduler.list(Date.UTC(2026, 4, 4), Date.UTC(2026, 4, 11));
    expect(events.map((e) => new Date(e.startTimestamp).toISOString())).toEqual([
      "2026-05-04T09:00:00.000Z", // Mon (untouched)
      "2026-05-08T14:00:00.000Z", // Fri (rescheduled)
    ]);
    const fri = events[1];
    expect(fri.payload.command).toBe("rsync --verbose");
    expect(fri.endTimestamp - fri.startTimestamp).toBe(2 * HOUR);
    expect(fri.alterationId).toBeDefined();
  });

  test("re-rescheduling the same occurrence replaces the prior alteration", async () => {
    const { scheduler, port } = makeScheduler();
    await scheduler.add({
      id: "tpl-1",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "x" },
    });
    await scheduler.reschedule("tpl-1", "2026-05-04", Date.UTC(2026, 4, 4, 12));
    await scheduler.reschedule("tpl-1", "2026-05-04", Date.UTC(2026, 4, 4, 16));

    const all = await port.listAlterationsByTemplate("tpl-1");
    expect(all).toHaveLength(1);
    expect(all[0].startTimestamp).toBe(Date.UTC(2026, 4, 4, 16));
  });
});

describe("Scheduler — update wipes alterations on rule change", () => {
  test("changing the rule clears existing alterations", async () => {
    const { scheduler, port } = makeScheduler();
    await scheduler.add({
      id: "tpl-1",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "x" },
    });
    await scheduler.cancel("tpl-1", "2026-05-04");
    expect(await port.listAlterationsByTemplate("tpl-1")).toHaveLength(1);

    await scheduler.update({
      id: "tpl-1",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Tuesday], // changed
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
    });
    expect(await port.listAlterationsByTemplate("tpl-1")).toHaveLength(0);
  });

  test("payload-only update keeps alterations", async () => {
    const { scheduler, port } = makeScheduler();
    await scheduler.add({
      id: "tpl-1",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "old" },
    });
    await scheduler.cancel("tpl-1", "2026-05-04");
    await scheduler.update({
      id: "tpl-1",
      payload: { type: "cron", command: "new" },
    });
    expect(await port.listAlterationsByTemplate("tpl-1")).toHaveLength(1);
  });

  test("days array order doesn't trigger wipe", async () => {
    const { scheduler, port } = makeScheduler();
    await scheduler.add({
      id: "tpl-1",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday, Day.Wednesday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "x" },
    });
    await scheduler.cancel("tpl-1", "2026-05-04");
    await scheduler.update({
      id: "tpl-1",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Wednesday, Day.Monday], // same set, different order
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
    });
    expect(await port.listAlterationsByTemplate("tpl-1")).toHaveLength(1);
  });
});

describe("Scheduler — next() and nextDue()", () => {
  test("next() finds the upcoming occurrence within horizon", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "weekly",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "x" },
    });
    const nxt = await scheduler.next("weekly", Date.UTC(2026, 4, 11, 12));
    // Next Monday after 2026-05-11 12:00 (which is Monday) is May 18 09:00.
    expect(nxt?.startTimestamp).toBe(Date.UTC(2026, 4, 18, 9));
  });

  test("next() returns null when no occurrence within horizon", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "once",
      timezone: "UTC",
      rule: {
        kind: "instant",
        startOn: Date.UTC(2026, 4, 11),
        timeSpan: { type: "duration", ms: HOUR },
      },
      payload: { type: "cron", command: "x" },
    });
    // Looking AFTER the once event.
    const nxt = await scheduler.next("once", Date.UTC(2026, 4, 12));
    expect(nxt).toBeNull();
  });

  test("nextDue() returns events from multiple templates sorted ascending", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "weekly",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "weekly" },
    });
    await scheduler.add({
      id: "once",
      timezone: "UTC",
      rule: {
        kind: "instant",
        startOn: Date.UTC(2026, 4, 13, 12),
        timeSpan: { type: "duration", ms: HOUR },
      },
      payload: { type: "cron", command: "once" },
    });

    const events = await scheduler.nextDue(Date.UTC(2026, 4, 11), 3);
    // From May 11 (after midnight): May 11 09 (weekly), May 13 12 (once),
    // May 18 09 (weekly). Note May 11 is Monday so 09:00 is included.
    expect(events.map((e) => e.payload.command)).toEqual(["weekly", "once", "weekly"]);
  });
});

describe("Scheduler — timeSpan normalization", () => {
  test("omitted timeSpan defaults to { type: 'duration', ms: 1 } (cron-fire)", async () => {
    const { scheduler, port } = makeScheduler();
    await scheduler.add({
      id: "fire",
      timezone: "UTC",
      rule: { kind: "instant", startOn: Date.UTC(2026, 4, 11, 14) }, // no timeSpan
      payload: { type: "cron", command: "ping" },
    });
    // Stored template's rule should now have timeSpan: { type: "duration", ms: 1 }.
    const stored = await port.getTemplate("fire");
    expect(stored?.rule.kind === "instant" && stored.rule.timeSpan).toEqual({
      type: "duration",
      ms: 1,
    });

    // list() should emit it even with a tight 1ms window starting AT the event.
    const events = await scheduler.list(Date.UTC(2026, 4, 11, 14), Date.UTC(2026, 4, 11, 14) + 1);
    expect(events).toHaveLength(1);
  });

  test("supplied timeSpan.ms < 1 throws", async () => {
    const { scheduler } = makeScheduler();
    await expect(
      scheduler.add({
        id: "bad",
        timezone: "UTC",
        rule: { kind: "instant", startOn: 0, timeSpan: { type: "duration", ms: 0 } },
        payload: { type: "cron", command: "x" },
      })
    ).rejects.toThrow(/timeSpan\.ms must be >= 1/);
  });
});

describe("Scheduler — write-side validation", () => {
  test("add throws on invalid rule", async () => {
    const { scheduler } = makeScheduler();
    await expect(
      scheduler.add({
        id: "bad",
        timezone: "UTC",
        rule: {
          kind: "anchored",
          anchorDate: 0,
          intervalMs: 0, // invalid
          seriesStart: 0,
          seriesEnd: null,
        },
        payload: { type: "cron", command: "x" },
      })
    ).rejects.toThrow(/intervalMs/);
  });

  test("update throws on invalid rule", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "tpl-1",
      timezone: "UTC",
      rule: {
        kind: "anchored",
        anchorDate: 0,
        intervalMs: 1000,
        seriesStart: 0,
        seriesEnd: null,
      },
      payload: { type: "cron", command: "x" },
    });
    await expect(
      scheduler.update({
        id: "tpl-1",
        rule: {
          kind: "weeksOfMonth",
          days: [Day.Monday],
          weeks: [0], // invalid
          monthInterval: 1,
          timeOfDay: 0,
          seriesStart: 0,
          seriesEnd: null,
        },
      })
    ).rejects.toThrow(/week/);
  });

  test("add throws on unknown disambiguation", async () => {
    const { scheduler } = makeScheduler();
    await expect(
      scheduler.add({
        id: "bad-dis",
        timezone: "America/Denver",
        // biome-ignore lint/suspicious/noExplicitAny: testing a runtime-invalid value
        disambiguation: "nonsense" as any,
        rule: { kind: "instant", startOn: 0 },
        payload: { type: "cron", command: "x" },
      })
    ).rejects.toThrow(/disambiguation/);
  });

  test("add throws on unknown timezone", async () => {
    const { scheduler } = makeScheduler();
    await expect(
      scheduler.add({
        id: "bad-tz",
        timezone: "America/Denvr", // typo
        rule: { kind: "instant", startOn: 0 },
        payload: { type: "cron", command: "x" },
      })
    ).rejects.toThrow(/timezone/i);
  });

  test("add throws on missing/empty timezone", async () => {
    const { scheduler } = makeScheduler();
    await expect(
      scheduler.add({
        id: "no-tz",
        // biome-ignore lint/suspicious/noExplicitAny: testing a runtime-invalid value
        timezone: undefined as any,
        rule: { kind: "instant", startOn: 0 },
        payload: { type: "cron", command: "x" },
      })
    ).rejects.toThrow(/timezone is required/);
  });

  test("update throws on unknown timezone", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "tz-1",
      timezone: "UTC",
      rule: { kind: "instant", startOn: 0 },
      payload: { type: "cron", command: "x" },
    });
    await expect(scheduler.update({ id: "tz-1", timezone: "Not/AZone" })).rejects.toThrow(
      /timezone/i
    );
  });
});

describe("Scheduler — disambiguation threads through to generators", () => {
  // A daily 02:30 event across the 2026-03-08 Denver spring-forward gap, where
  // 02:30 doesn't exist. The template-level disambiguation should drive how
  // that day resolves. Window: just Mar 8 in UTC terms.
  const dayWindowStart = Date.UTC(2026, 2, 8, 6); // 06:00Z (Mar 7 23:00 MST)
  const dayWindowEnd = Date.UTC(2026, 2, 9, 6);

  function dailyAt0230(): ScheduleTemplate<CronPayload> {
    return {
      id: "daily",
      timezone: "America/Denver",
      rule: {
        kind: "daysOfWeek",
        days: [
          Day.Sunday,
          Day.Monday,
          Day.Tuesday,
          Day.Wednesday,
          Day.Thursday,
          Day.Friday,
          Day.Saturday,
        ],
        weekInterval: 1,
        timeOfDay: 2 * HOUR + 30 * 60_000,
        seriesStart: Date.UTC(2026, 2, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "x" },
    };
  }

  test("default (compatible) moves the gap occurrence forward to 09:30Z", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add(dailyAt0230());
    const events = await scheduler.list(dayWindowStart, dayWindowEnd);
    expect(events).toHaveLength(1);
    expect(new Date(events[0].startTimestamp).toISOString()).toBe("2026-03-08T09:30:00.000Z");
  });

  test("skip drops the nonexistent gap occurrence", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({ ...dailyAt0230(), disambiguation: "skip" });
    const events = await scheduler.list(dayWindowStart, dayWindowEnd);
    expect(events).toHaveLength(0);
  });
});

describe("Scheduler — remove cleans up alterations", () => {
  test("remove deletes the template and its alterations", async () => {
    const { scheduler, port } = makeScheduler();
    await scheduler.add({
      id: "tpl-1",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2026, 4, 4),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "x" },
    });
    await scheduler.cancel("tpl-1", "2026-05-04");
    await scheduler.remove("tpl-1");

    expect(await port.getTemplate("tpl-1")).toBeNull();
    expect(await port.listAlterationsByTemplate("tpl-1")).toHaveLength(0);
  });
});

describe("Scheduler — list with empty window", () => {
  test("returns empty when windowEnd <= windowStart", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "once",
      timezone: "UTC",
      rule: {
        kind: "instant",
        startOn: Date.UTC(2026, 4, 11),
        timeSpan: { type: "duration", ms: HOUR },
      },
      payload: { type: "cron", command: "x" },
    });
    const events = await scheduler.list(Date.UTC(2026, 4, 11), Date.UTC(2026, 4, 11));
    expect(events).toEqual([]);
  });
});

describe("Scheduler — DST-aware recurrence", () => {
  test("Mon 9am Denver weekly stays at 9am wall across spring forward", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "denver-weekly",
      timezone: "America/Denver",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2025, 2, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "morning" },
    });

    // Window: Mar 1 .. Mar 24, 2025. Spring forward is Sun Mar 9.
    // Mondays: Mar 3 (MST → 16 UTC), Mar 10 (MDT → 15 UTC), Mar 17 (MDT → 15 UTC).
    const events = await scheduler.list(Date.UTC(2025, 2, 1), Date.UTC(2025, 2, 24));
    expect(events.map((e) => new Date(e.startTimestamp).toISOString())).toEqual([
      "2025-03-03T16:00:00.000Z",
      "2025-03-10T15:00:00.000Z",
      "2025-03-17T15:00:00.000Z",
    ]);
  });
});

describe("Scheduler — alterations across DST", () => {
  // The hypothesis: occurrenceKey is the wall-clock date in the template's
  // tz, so it stays stable across DST. A cancel/reschedule applied to a
  // post-transition occurrence should match correctly even though the UTC
  // instant of that occurrence differs from a hypothetical no-DST world.

  test("cancel a Monday after spring forward suppresses only that occurrence", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "denver-weekly",
      timezone: "America/Denver",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2025, 2, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "morning" },
    });

    // Cancel the post-spring-forward Monday. Key is the wall-clock date in
    // Denver tz, which is "2025-03-10" regardless of DST.
    await scheduler.cancel("denver-weekly", "2025-03-10");

    const events = await scheduler.list(Date.UTC(2025, 2, 1), Date.UTC(2025, 2, 24));
    expect(events.map((e) => new Date(e.startTimestamp).toISOString())).toEqual([
      "2025-03-03T16:00:00.000Z", // pre-DST Mon kept
      // Mar 10 cancelled
      "2025-03-17T15:00:00.000Z", // post-DST Mon kept
    ]);
  });

  test("reschedule a fall-back-week Monday lands on the new wall time correctly", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "denver-weekly",
      timezone: "America/Denver",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2025, 9, 1), // Oct 1 2025
        seriesEnd: null,
      },
      payload: { type: "cron", command: "morning" },
    });

    // Fall back is Sun 2025-11-02. The Monday after fall-back is Nov 3,
    // which is the first MST Monday (offset -7). Reschedule that Monday
    // to 14:00 wall-clock. Wall time interpreted in Denver tz (MST) →
    // 14:00 - (-7h) = 21:00 UTC.
    const newStartUtc = Date.UTC(2025, 10, 3, 21); // 14:00 MST = 21:00 UTC
    await scheduler.reschedule("denver-weekly", "2025-11-03", newStartUtc, {
      type: "duration",
      ms: HOUR,
    });

    const events = await scheduler.list(Date.UTC(2025, 9, 27), Date.UTC(2025, 10, 10));
    // Mondays: Oct 27 (MDT → 15 UTC), Nov 3 (rescheduled → 21 UTC).
    expect(events.map((e) => new Date(e.startTimestamp).toISOString())).toEqual([
      "2025-10-27T15:00:00.000Z",
      "2025-11-03T21:00:00.000Z", // rescheduled
    ]);
    const moved = events[1];
    expect(moved.alterationId).toBeDefined();
    expect(moved.occurrenceKey).toBe("2025-11-03");
  });

  test("cancel of an occurrence whose UTC start differs across DST still matches by wall-date", async () => {
    // Same template recurring across spring-forward in Denver. We cancel
    // by the wall-date key — the matching must NOT depend on the UTC
    // timestamp (which shifts by 1 hour across the DST boundary).
    const { scheduler, port } = makeScheduler();
    await scheduler.add({
      id: "denver-weekly",
      timezone: "America/Denver",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday, Day.Friday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2025, 2, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "x" },
    });
    // Cancel Friday Mar 7 (MST, pre-DST) AND Friday Mar 14 (MDT, post-DST).
    await scheduler.cancel("denver-weekly", "2025-03-07");
    await scheduler.cancel("denver-weekly", "2025-03-14");

    const events = await scheduler.list(Date.UTC(2025, 2, 1), Date.UTC(2025, 2, 17));
    // Expected: Mon Mar 3 (16 UTC), Mon Mar 10 (15 UTC). Both Fridays are
    // cancelled; the cancel keys are the wall-clock dates.
    expect(events.map((e) => new Date(e.startTimestamp).toISOString())).toEqual([
      "2025-03-03T16:00:00.000Z",
      "2025-03-10T15:00:00.000Z",
    ]);
    // Sanity: both alterations stored.
    expect(await port.listAlterationsByTemplate("denver-weekly")).toHaveLength(2);
  });

  test("nth weekday of month: cancel on the post-DST occurrence works", async () => {
    // 2nd Monday of every month in Denver. Mar 2025 2nd Mon = Mar 10
    // (post-DST). Cancel it.
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "monthly",
      timezone: "America/Denver",
      rule: {
        kind: "weeksOfMonth",
        days: [Day.Monday],
        weeks: [2],
        monthInterval: 1,
        timeOfDay: 10 * HOUR,
        timeSpan: { type: "duration", ms: HOUR },
        seriesStart: Date.UTC(2025, 0, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "monthly" },
    });
    await scheduler.cancel("monthly", "2025-03-10");

    const events = await scheduler.list(Date.UTC(2025, 0, 1), Date.UTC(2025, 5, 1));
    // 2nd Mondays: Jan 13 (MST → 17 UTC), Feb 10 (MST → 17 UTC),
    // Mar 10 (MDT → 16 UTC, CANCELLED), Apr 14 (MDT → 16 UTC),
    // May 12 (MDT → 16 UTC).
    expect(events.map((e) => new Date(e.startTimestamp).toISOString())).toEqual([
      "2025-01-13T17:00:00.000Z",
      "2025-02-10T17:00:00.000Z",
      "2025-04-14T16:00:00.000Z",
      "2025-05-12T16:00:00.000Z",
    ]);
  });
});

describe("Scheduler — duration spans DST", () => {
  // duration is UTC ms. A shift that crosses a DST transition still has
  // exactly its specified duration in real-world elapsed time — only the
  // wall-clock display is "wrong" by ±1 hour.

  test("8h shift starting 23:00 the night before spring forward = 8h UTC", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "night-shift",
      timezone: "America/Denver",
      rule: {
        kind: "daysOfWeek",
        // Saturday Mar 8 night → Sunday Mar 9 morning. The DST flip is at
        // 02:00 MST on Sun Mar 9, mid-shift.
        days: [Day.Saturday],
        weekInterval: 1,
        timeOfDay: 23 * HOUR, // 11 PM
        timeSpan: { type: "duration", ms: 8 * HOUR },
        seriesStart: Date.UTC(2025, 2, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "shift" },
    });

    const events = await scheduler.list(Date.UTC(2025, 2, 8), Date.UTC(2025, 2, 10));
    // Sat Mar 8 23:00 MST = 06:00 UTC Mar 9.
    // Mid-shift, DST flip at 09:00 UTC. Shift continues, ends 8h after start.
    // 06:00 UTC + 8h = 14:00 UTC = 08:00 MDT Mar 9.
    expect(events).toHaveLength(1);
    const shift = events[0];
    expect(new Date(shift.startTimestamp).toISOString()).toBe("2025-03-09T06:00:00.000Z");
    expect(new Date(shift.endTimestamp).toISOString()).toBe("2025-03-09T14:00:00.000Z");
    // Most important: actual elapsed UTC duration is exactly 8 hours.
    expect(shift.endTimestamp - shift.startTimestamp).toBe(8 * HOUR);
  });

  test("8h shift starting 23:00 the night before fall back = 8h UTC", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "night-shift",
      timezone: "America/Denver",
      rule: {
        kind: "daysOfWeek",
        // Sat Nov 1 23:00 MDT → Sun Nov 2 morning. Fall back is 02:00 MDT
        // (= 08:00 UTC), so clocks repeat 01:00–01:59. Shift sees a wall
        // clock that goes 23:00 MDT → 00:00 → 01:00 MDT → 01:59 MDT →
        // 01:00 MST → 01:59 MST → 02:00 MST → ... → 06:00 MST. That's 7
        // wall-hours but 8 actual hours.
        days: [Day.Saturday],
        weekInterval: 1,
        timeOfDay: 23 * HOUR,
        timeSpan: { type: "duration", ms: 8 * HOUR },
        seriesStart: Date.UTC(2025, 9, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "shift" },
    });

    const events = await scheduler.list(Date.UTC(2025, 10, 1), Date.UTC(2025, 10, 3));
    // Sat Nov 1 23:00 MDT = 05:00 UTC Nov 2 (offset -6).
    // 05:00 UTC + 8h = 13:00 UTC = 06:00 MST Nov 2 (offset -7 post-fallback).
    expect(events).toHaveLength(1);
    const shift = events[0];
    expect(new Date(shift.startTimestamp).toISOString()).toBe("2025-11-02T05:00:00.000Z");
    expect(new Date(shift.endTimestamp).toISOString()).toBe("2025-11-02T13:00:00.000Z");
    expect(shift.endTimestamp - shift.startTimestamp).toBe(8 * HOUR);
  });
});

describe("Scheduler — hourSpan across DST", () => {
  // hourSpan tracks wall-clock hours, not UTC ms. The real-elapsed UTC time
  // of the same hourSpan changes by ±1 hour across DST transitions.

  test("8h hourSpan starting 23:00 spring-forward eve = 7h UTC (one wall-hour eaten)", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "night-shift",
      timezone: "America/Denver",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Saturday],
        weekInterval: 1,
        timeOfDay: 23 * HOUR,
        timeSpan: { type: "hourSpan", hours: 8 },
        seriesStart: Date.UTC(2025, 2, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "shift" },
    });

    const events = await scheduler.list(Date.UTC(2025, 2, 8), Date.UTC(2025, 2, 10));
    expect(events).toHaveLength(1);
    const shift = events[0];
    // Start: Sat Mar 8 23:00 MST = 06:00 UTC Mar 9.
    expect(new Date(shift.startTimestamp).toISOString()).toBe("2025-03-09T06:00:00.000Z");
    // End: 23:00 + 8 WALL hours = 07:00 next wall day in Denver, which is
    // 07:00 MDT (post-DST) = 13:00 UTC. Real elapsed = 7 actual hours.
    expect(new Date(shift.endTimestamp).toISOString()).toBe("2025-03-09T13:00:00.000Z");
    expect(shift.endTimestamp - shift.startTimestamp).toBe(7 * HOUR);
  });

  test("8h hourSpan starting 23:00 fall-back eve = 9h UTC (extra wall-hour)", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "night-shift",
      timezone: "America/Denver",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Saturday],
        weekInterval: 1,
        timeOfDay: 23 * HOUR,
        timeSpan: { type: "hourSpan", hours: 8 },
        seriesStart: Date.UTC(2025, 9, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "shift" },
    });

    const events = await scheduler.list(Date.UTC(2025, 10, 1), Date.UTC(2025, 10, 3));
    expect(events).toHaveLength(1);
    const shift = events[0];
    // Start: Sat Nov 1 23:00 MDT = 05:00 UTC Nov 2.
    expect(new Date(shift.startTimestamp).toISOString()).toBe("2025-11-02T05:00:00.000Z");
    // End: 23:00 + 8 WALL hours = 07:00 next wall day in Denver, which is
    // 07:00 MST (post-fall-back) = 14:00 UTC. Real elapsed = 9 actual hours.
    expect(new Date(shift.endTimestamp).toISOString()).toBe("2025-11-02T14:00:00.000Z");
    expect(shift.endTimestamp - shift.startTimestamp).toBe(9 * HOUR);
  });

  test("fractional hourSpan: 7.5 wall-hours", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "shift",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 9 * HOUR,
        timeSpan: { type: "hourSpan", hours: 7.5 },
        seriesStart: Date.UTC(2026, 4, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "x" },
    });
    const events = await scheduler.list(Date.UTC(2026, 4, 4), Date.UTC(2026, 4, 5));
    // Mon May 4 2026, 9:00 UTC + 7.5h = 16:30 UTC. No DST in UTC.
    expect(new Date(events[0].endTimestamp).toISOString()).toBe("2026-05-04T16:30:00.000Z");
  });

  test("hourSpan crosses wall midnight: 12h span starting at 18:00", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "long",
      timezone: "UTC",
      rule: {
        kind: "daysOfWeek",
        days: [Day.Monday],
        weekInterval: 1,
        timeOfDay: 18 * HOUR,
        timeSpan: { type: "hourSpan", hours: 12 },
        seriesStart: Date.UTC(2026, 4, 1),
        seriesEnd: null,
      },
      payload: { type: "cron", command: "x" },
    });
    const events = await scheduler.list(Date.UTC(2026, 4, 4), Date.UTC(2026, 4, 6));
    // Mon May 4 18:00 UTC + 12h = Tue May 5 06:00 UTC
    expect(new Date(events[0].startTimestamp).toISOString()).toBe("2026-05-04T18:00:00.000Z");
    expect(new Date(events[0].endTimestamp).toISOString()).toBe("2026-05-05T06:00:00.000Z");
  });

  test("hourSpan on Instant in UTC = hours * 3_600_000 (no DST to flex)", async () => {
    const { scheduler } = makeScheduler();
    await scheduler.add({
      id: "once",
      timezone: "UTC",
      rule: {
        kind: "instant",
        startOn: Date.UTC(2026, 4, 11, 12),
        timeSpan: { type: "hourSpan", hours: 2 },
      },
      payload: { type: "cron", command: "x" },
    });
    const events = await scheduler.list(Date.UTC(2026, 4, 11), Date.UTC(2026, 4, 12));
    expect(events).toHaveLength(1);
    expect(events[0].endTimestamp - events[0].startTimestamp).toBe(2 * HOUR);
  });
});
