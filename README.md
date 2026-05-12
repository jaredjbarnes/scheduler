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

await scheduler.addTemplate({
  id: "standup",
  tz: "America/Denver",
  rule: {
    kind: "daysOfWeek",
    days: [Day.Mon, Day.Tue, Day.Wed, Day.Thu, Day.Fri],
    timeOfDay: 9 * 60 * 60 * 1000, // 9:00 wall-clock
    weekInterval: 1,
    seriesStart: Date.UTC(2026, 0, 1),
  },
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

- **Recurrence rules** — `OnceRule`, `AnchoredRule`, `DaysOfWeekRule`, `WeeksOfMonthRule`, `MonthsOfYearRule`, `YearlyRule`, `DaysOfMonthRule`, `DaysOfYearRule`. Pure-data, JSON-serializable, exhaustive TypeScript union.
- **TimeSpan** — two flavors of "how long does an occurrence last":
  - `{ type: "duration", ms }` — fixed real-elapsed time (payroll-correct, ignores DST jumps).
  - `{ type: "hourSpan", hours }` — wall-clock hours (calendar-correct, flexes with DST).
- **Timezone math** — built on `Intl.DateTimeFormat`, zero deps for date logic. Spring-forward and fall-back handled explicitly.
- **Alterations** — per-occurrence overrides (skip, reschedule, replace).
- **Dispatcher** — drives a Scheduler in real time; catch-up pass for missed events, resumes early when the schedule changes.

## API surface

See [`src/index.ts`](./src/index.ts) for the full export list. Notable types:

- `RecurrenceRule` — discriminated union over the eight rule kinds.
- `ScheduleTemplate` — `{ id, tz?, rule, timeSpan?, alterations? }`.
- `ScheduledEvent` — `{ templateId, startTimestamp, endTimestamp }`.
- `SchedulerPort` — async storage interface; an `InMemorySchedulerPort` ships with the package.
- `DispatcherStore` — durable record of the dispatcher's catch-up cursor.

## License

MIT
