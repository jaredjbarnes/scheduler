import type { IEventSubscription } from "@j13b/state/core";
import { type DispatcherStore, InMemoryDispatcherStore } from "./dispatcher_store";
import type { Scheduler } from "./scheduler";
import type { ScheduledEvent } from "./types";

// Default safety-net wait when nothing is scheduled. The Scheduler.changed
// event normally wakes us as soon as something gets added, so this is just
// a backstop in case a notification is missed.
const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60 * 1000;

export interface DispatcherConfig<TPayload extends { type: string }> {
  scheduler: Scheduler<TPayload>;
  // Called for each due event in cursor → now order. Errors thrown from here
  // are passed to onError; the cursor advances regardless (cron-style: a
  // permanently-failing fire shouldn't block the queue forever).
  fire: (event: ScheduledEvent<TPayload>) => Promise<void> | void;
  // Persists the cursor across restarts. Defaults to in-memory (no recovery).
  store?: DispatcherStore;
  // Called when fire() throws or list() fails. Defaults to console.error.
  onError?: (err: unknown, event?: ScheduledEvent<TPayload>) => void;
  // Backstop wait when no event is scheduled. Default 1 hour. Lower for tests.
  idleTimeoutMs?: number;
  // Clock injection (Date.now) and timer injection (setTimeout/clearTimeout).
  // Defaults to wall clock. Inject for deterministic tests.
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

// Drives a Scheduler in real time. The loop:
//   1. Catch up: list(cursor, now) → fire each → advance cursor → save.
//   2. Find next: nextDue(now, 1) → wait until its startTimestamp.
//   3. Wait may end early via Scheduler.changed (a write happened) or stop().
// Catch-up handles crashes AND in-process adds we missed. The change event
// handles in-process adds while we're sleeping — the dispatcher wakes
// immediately and re-queries instead of firing the stale "next" event late.
export class Dispatcher<TPayload extends { type: string }> {
  private readonly _scheduler: Scheduler<TPayload>;
  private readonly _fire: (event: ScheduledEvent<TPayload>) => Promise<void> | void;
  private readonly _store: DispatcherStore;
  private readonly _onError: (err: unknown, event?: ScheduledEvent<TPayload>) => void;
  private readonly _idleTimeoutMs: number;
  private readonly _now: () => number;
  private readonly _setTimeout: (fn: () => void, ms: number) => unknown;
  private readonly _clearTimeout: (handle: unknown) => void;

  private _running = false;
  private _wakeResolve: (() => void) | null = null;
  private _changeSubscription: IEventSubscription<void> | null = null;

  constructor(config: DispatcherConfig<TPayload>) {
    this._scheduler = config.scheduler;
    this._fire = config.fire;
    this._store = config.store ?? new InMemoryDispatcherStore();
    this._onError = config.onError ?? defaultOnError;
    this._idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this._now = config.now ?? Date.now;
    this._setTimeout = config.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
    this._clearTimeout =
      config.clearTimeout ?? ((h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  // Starts the loop. Resolves after the first catch-up pass completes (so
  // tests can await an initial sync). The loop keeps running in the
  // background until stop() is called.
  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;
    this._changeSubscription = this._scheduler.changed.subscribe(() => this._wake());
    // First iteration in foreground so callers can await initial catch-up.
    await this._tick();
    if (this._running) void this._loop();
  }

  // Halts the loop. Any in-flight fire() completes; subsequent fires are
  // skipped. The Scheduler subscription is removed.
  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (this._changeSubscription != null) {
      this._changeSubscription.unsubscribe();
      this._changeSubscription = null;
    }
    this._wake();
  }

  // ─── Internals ──────────────────────────────────────────────

  private async _loop(): Promise<void> {
    while (this._running) {
      const target = await this._findNextTarget();
      if (!this._running) return;
      await this._sleepUntil(target);
      if (!this._running) return;
      await this._tick();
    }
  }

  // Returns the epoch-ms instant the dispatcher should next wake. Either
  // the next due event's startTimestamp, or now + idleTimeoutMs.
  private async _findNextTarget(): Promise<number> {
    try {
      const upcoming = await this._scheduler.nextDue(this._now(), 1);
      const next = upcoming[0];
      return next != null ? next.startTimestamp : this._now() + this._idleTimeoutMs;
    } catch (err) {
      this._onError(err);
      return this._now() + this._idleTimeoutMs;
    }
  }

  // Catch-up pass: fire everything with start in [cursor, now]. We use
  // `now + 1` as the half-open windowEnd so an event scheduled exactly at
  // the wake instant is included (the wake from setTimeout lands on the
  // event's startTimestamp, and we don't want to miss it). Advancing the
  // cursor to `now + 1` likewise avoids re-listing the same event on the
  // next tick.
  private async _tick(): Promise<void> {
    const cursor = (await this._store.loadCursor()) ?? this._now();
    const now = this._now();
    const windowEnd = now + 1;
    if (windowEnd <= cursor) {
      // Cursor is already at or past `now + 1` — happens on the very first
      // tick when we just-saved-and-rewoke. Nothing to do.
      return;
    }

    let events: ScheduledEvent<TPayload>[];
    try {
      events = await this._scheduler.list(cursor, windowEnd);
    } catch (err) {
      this._onError(err);
      // Don't advance cursor on a list failure — try again next tick.
      return;
    }

    for (const event of events) {
      if (!this._running) return;
      try {
        await this._fire(event);
      } catch (err) {
        this._onError(err, event);
      }
    }
    await this._store.saveCursor(windowEnd);
  }

  // Sleeps until either the target epoch-ms instant, or wake() is called
  // (via Scheduler.changed or stop()). No-op if target is already past.
  private async _sleepUntil(targetMs: number): Promise<void> {
    const remaining = targetMs - this._now();
    if (remaining <= 0) return;
    await new Promise<void>((resolve) => {
      let done = false;
      const timer = this._setTimeout(() => {
        if (done) return;
        done = true;
        this._wakeResolve = null;
        resolve();
      }, remaining);
      this._wakeResolve = () => {
        if (done) return;
        done = true;
        this._clearTimeout(timer);
        this._wakeResolve = null;
        resolve();
      };
    });
  }

  // Resolves any in-flight _sleepUntil. Called by stop() and by the
  // Scheduler.changed subscription.
  private _wake(): void {
    if (this._wakeResolve != null) this._wakeResolve();
  }
}

function defaultOnError(err: unknown, event?: ScheduledEvent<{ type: string }>): void {
  if (event != null) {
    console.error(`[Dispatcher] fire failed for ${event.templateId}/${event.occurrenceKey}:`, err);
  } else {
    console.error("[Dispatcher] error:", err);
  }
}
