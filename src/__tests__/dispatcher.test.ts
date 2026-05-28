import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dispatcher } from "../dispatcher";
import { InMemoryDispatcherStore } from "../dispatcher_store";
import { InMemorySchedulerPort } from "../in_memory_port";
import { Scheduler } from "../scheduler";
import type { ScheduledEvent } from "../types";

interface CronPayload {
  type: "cron";
  command: string;
}

const HOUR = 3_600_000;
const T0_DATE = new Date(2026, 4, 11, 0, 0, 0);

// Each test captures a single T0 (the test's "logical now") and derives
// everything from it — cursor seeds, event startOns, expectation timestamps.
// This removes any implicit dependency on Date.now() being frozen by fake
// timers between calls. If you ever remove vi.useFakeTimers() or someone
// changes the harness, the tests still mean the same thing.
function makeFakes() {
  const port = new InMemorySchedulerPort<CronPayload>();
  const scheduler = new Scheduler(port);
  const fired: ScheduledEvent<CronPayload>[] = [];
  const errors: { err: unknown; event?: ScheduledEvent<CronPayload> }[] = [];
  const store = new InMemoryDispatcherStore();
  const T0 = T0_DATE.getTime();
  return { port, scheduler, fired, errors, store, T0 };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0_DATE);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Dispatcher — catch-up on start", () => {
  test("fires all events between cursor and now on first tick", async () => {
    const { scheduler, fired, store, T0 } = makeFakes();
    // Pre-seed the cursor at T0.
    await store.saveCursor(T0);

    // Add three events at known offsets from T0.
    await scheduler.add({
      id: "e1",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + 1 * HOUR },
      payload: { type: "cron", command: "1" },
    });
    await scheduler.add({
      id: "e2",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + 2 * HOUR },
      payload: { type: "cron", command: "2" },
    });
    await scheduler.add({
      id: "e3",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + 5 * HOUR },
      payload: { type: "cron", command: "3" },
    });

    // Simulate downtime: jump the wall clock to T0 + 3h, past the first two.
    vi.setSystemTime(new Date(T0 + 3 * HOUR));

    const dispatcher = new Dispatcher({
      scheduler,
      fire: async (event) => {
        fired.push(event);
      },
      store,
    });
    await dispatcher.start();
    dispatcher.stop();

    expect(fired.map((e) => e.payload.command)).toEqual(["1", "2"]);
  });

  test("first run with no cursor seeds it to now (no backfill)", async () => {
    const { scheduler, fired, store, T0 } = makeFakes();
    // Event 1 hour before T0 — would fire if cursor were earlier than T0.
    await scheduler.add({
      id: "past",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 - HOUR },
      payload: { type: "cron", command: "past" },
    });

    const dispatcher = new Dispatcher({
      scheduler,
      fire: async (e) => {
        fired.push(e);
      },
      store,
    });
    await dispatcher.start();
    dispatcher.stop();

    // Cursor was null → seeded to T0 → past event not in [T0, T0+1) range.
    expect(fired).toHaveLength(0);
    // Cursor advances to `now + 1` (windowEnd convention) so events at
    // exactly `now` would be picked up but not re-emitted on the next tick.
    expect(await store.loadCursor()).toBe(T0 + 1);
  });
});

describe("Dispatcher — live firing", () => {
  test("fires an event when its time arrives", async () => {
    const { scheduler, fired, store, T0 } = makeFakes();
    await store.saveCursor(T0);

    await scheduler.add({
      id: "soon",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + HOUR },
      payload: { type: "cron", command: "ping" },
    });

    const dispatcher = new Dispatcher({
      scheduler,
      fire: async (e) => {
        fired.push(e);
      },
      store,
    });
    await dispatcher.start();

    // Advance to just past the event.
    await vi.advanceTimersByTimeAsync(HOUR + 100);
    dispatcher.stop();

    expect(fired.map((e) => e.payload.command)).toEqual(["ping"]);
  });
});

describe("Dispatcher — wake on add (the race)", () => {
  test("adding an event during sleep wakes the dispatcher and fires it on time", async () => {
    const { scheduler, fired, store, T0 } = makeFakes();
    await store.saveCursor(T0);

    // Initial event 5 hours out from T0.
    await scheduler.add({
      id: "later",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + 5 * HOUR },
      payload: { type: "cron", command: "later" },
    });

    const dispatcher = new Dispatcher({
      scheduler,
      fire: async (e) => {
        fired.push(e);
      },
      store,
    });
    await dispatcher.start();

    // 30 minutes pass — dispatcher is sleeping until T0 + 5h.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(fired).toHaveLength(0);

    // A new event gets added at T0 + 1h — before "later". Scheduler.changed
    // notifies; dispatcher wakes from its sleep and re-queries nextDue.
    await scheduler.add({
      id: "sooner",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + 1 * HOUR },
      payload: { type: "cron", command: "sooner" },
    });
    // Let microtasks settle (the wake is sync but the loop is async).
    await vi.advanceTimersByTimeAsync(0);

    // Advance past "sooner"'s firing time (T0 + 1h, currently at T0 + 30m).
    await vi.advanceTimersByTimeAsync(40 * 60 * 1000); // total +1h10m
    expect(fired.map((e) => e.payload.command)).toContain("sooner");
    expect(fired).toHaveLength(1); // only sooner so far

    // Continue past "later" (T0 + 5h).
    await vi.advanceTimersByTimeAsync(5 * HOUR);
    dispatcher.stop();

    expect(fired.map((e) => e.payload.command)).toEqual(["sooner", "later"]);
  });
});

describe("Dispatcher — failure handling", () => {
  test("fire throwing: logged via onError, cursor still advances", async () => {
    const { scheduler, fired, errors, store, T0 } = makeFakes();
    await store.saveCursor(T0);

    await scheduler.add({
      id: "bad",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + HOUR },
      payload: { type: "cron", command: "boom" },
    });
    await scheduler.add({
      id: "good",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + 2 * HOUR },
      payload: { type: "cron", command: "ok" },
    });

    const dispatcher = new Dispatcher({
      scheduler,
      fire: async (e) => {
        if (e.payload.command === "boom") throw new Error("kaboom");
        fired.push(e);
      },
      store,
      onError: (err, event) => {
        errors.push({ err, event });
      },
    });
    await dispatcher.start();

    await vi.advanceTimersByTimeAsync(3 * HOUR);
    dispatcher.stop();

    expect(errors).toHaveLength(1);
    expect((errors[0].err as Error).message).toBe("kaboom");
    expect(errors[0].event?.payload.command).toBe("boom");
    // The "good" event still fires after the failure.
    expect(fired.map((e) => e.payload.command)).toEqual(["ok"]);
  });
});

describe("Dispatcher — stop()", () => {
  test("stop prevents further firing", async () => {
    const { scheduler, fired, store, T0 } = makeFakes();
    await store.saveCursor(T0);

    await scheduler.add({
      id: "a",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + HOUR },
      payload: { type: "cron", command: "a" },
    });
    await scheduler.add({
      id: "b",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + 2 * HOUR },
      payload: { type: "cron", command: "b" },
    });

    const dispatcher = new Dispatcher({
      scheduler,
      fire: async (e) => {
        fired.push(e);
      },
      store,
    });
    await dispatcher.start();

    await vi.advanceTimersByTimeAsync(HOUR + 100);
    dispatcher.stop();
    await vi.advanceTimersByTimeAsync(10 * HOUR);

    expect(fired.map((e) => e.payload.command)).toEqual(["a"]);
  });

  test("stop is idempotent", async () => {
    const { scheduler, store, T0 } = makeFakes();
    await store.saveCursor(T0);
    const dispatcher = new Dispatcher({
      scheduler,
      fire: async () => {},
      store,
    });
    await dispatcher.start();
    dispatcher.stop();
    expect(() => dispatcher.stop()).not.toThrow();
  });
});

describe("Dispatcher — cursor persistence", () => {
  test("cursor survives stop/start, preventing re-fire", async () => {
    const { scheduler, fired, store, T0 } = makeFakes();
    await store.saveCursor(T0);

    await scheduler.add({
      id: "e1",
      timezone: "UTC",
      rule: { kind: "instant", startOn: T0 + HOUR },
      payload: { type: "cron", command: "1" },
    });

    let dispatcher = new Dispatcher({
      scheduler,
      fire: async (e) => {
        fired.push(e);
      },
      store,
    });
    await dispatcher.start();
    await vi.advanceTimersByTimeAsync(HOUR + 100);
    dispatcher.stop();
    expect(fired).toHaveLength(1);

    // Restart — cursor is now past the event, so it shouldn't re-fire.
    dispatcher = new Dispatcher({
      scheduler,
      fire: async (e) => {
        fired.push(e);
      },
      store,
    });
    await dispatcher.start();
    await vi.advanceTimersByTimeAsync(5 * HOUR);
    dispatcher.stop();

    expect(fired).toHaveLength(1);
  });
});
