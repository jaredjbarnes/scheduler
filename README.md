# @j13b/scheduler

A timezone-aware recurrence and dispatch engine. Pure-data rule DSL, IANA timezone support, DST-aware generators, and a cron-style dispatcher.

## Install

```bash
npm install @j13b/scheduler
```

## Quick start

```ts
import {
  Scheduler,
  InMemorySchedulerPort,
  Dispatcher,
  InMemoryDispatcherStore,
  Day,
} from "@j13b/scheduler";

const port = new InMemorySchedulerPort();
const scheduler = new Scheduler(port);

await scheduler.add({
  id: "standup",
  timezone: "America/Denver",
  rule: {
    kind: "daysOfWeek",
    days: [Day.Monday, Day.Tuesday, Day.Wednesday, Day.Thursday, Day.Friday],
    timeOfDay: 9 * 60 * 60 * 1000, // 9:00 wall-clock
    weekInterval: 1,
    seriesStart: Date.UTC(2026, 0, 1),
    seriesEnd: null, // open-ended
  },
  payload: { type: "standup" },
});

const dispatcher = new Dispatcher({
  scheduler,
  store: new InMemoryDispatcherStore(),
  fire: async (event) => {
    console.log(`Fire ${event.templateId} at ${new Date(event.startTimestamp).toISOString()}`);
  },
});

await dispatcher.start();
```

## What's in the box

- **Recurrence rules** — `InstantRule`, `LocalDateTimeRule`, `AnchoredRule`, `DaysOfWeekRule`, `WeeksOfMonthRule`, `MonthsOfYearRule`, `YearlyRule`, `DaysOfMonthRule`, `DaysOfYearRule`. Pure-data, JSON-serializable, exhaustive TypeScript union. The two single-occurrence kinds: `InstantRule` fires at an absolute UTC instant (timezone-independent); `LocalDateTimeRule` fires once at a wall-clock date/time resolved (DST-aware) in the template's timezone.
- **TimeSpan** — two flavors of "how long does an occurrence last":
  - `{ type: "duration", ms }` — fixed real-elapsed time (payroll-correct, ignores DST jumps).
  - `{ type: "hourSpan", hours }` — wall-clock hours (calendar-correct, flexes with DST).
- **Timezone math** — built on `Intl.DateTimeFormat` over IANA zones, zero deps for date logic. Spring-forward gaps and fall-back overlaps are resolved by a configurable per-template `disambiguation` policy (`"compatible"` default, plus `"earlier"`, `"later"`, `"reject"`, and `"skip"`), mirroring the Temporal proposal.
- **Alterations** — per-occurrence overrides (skip, reschedule, replace).
- **Dispatcher** — drives a Scheduler in real time; catch-up pass for missed events, resumes early when the schedule changes.

## API surface

See [`src/index.ts`](./src/index.ts) for the full export list. Notable types:

- `RecurrenceRule` — discriminated union over the nine rule kinds.
- `ScheduleTemplate` — `{ id, rule, timezone, disambiguation?, payload }`. `timezone` is required and validated at write time (use `"UTC"` for zone-free scheduling; it's ignored by the absolute `instant`/`anchored` rules).
- `validateRule(rule)` — checks a rule's whole shape (every required field present, typed and in range; no fields its kind lacks) and throws an `Error` naming the field and the form it expects. `Scheduler.add`/`update` run it, so a rule from JSON or an LLM fails with a clear message instead of crashing a generator. `validateTimeSpan` and `RULE_KINDS` are exported too.
- `ScheduledEvent` — `{ templateId, occurrenceKey, startTimestamp, endTimestamp, payload, alterationId? }`.
- `Disambiguation` — DST-edge resolution policy: `"compatible" | "earlier" | "later" | "reject" | "skip"`.
- `SchedulerPort` — async storage interface; an `InMemorySchedulerPort` ships with the package.
- `DispatcherStore` — durable record of the dispatcher's catch-up cursor.

## License

MIT
