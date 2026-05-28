// All types are plain data — safe to JSON-serialize and store in a JSON column.
// Generated occurrences carry a TPayload so consumers can attach whatever
// domain data they need (cron action, calendar event body, etc.).
//
// ─── DST gotchas for wall-clock rules ───────────────────────────────────────
//
// daysOfWeek / weekOfMonth / yearly rules use wall-clock fields (timeOfDay,
// day-of-week, month/day) interpreted in the template's `timezone`. In a tz
// that observes DST, two edge cases exist:
//
// 1. Spring-forward gap. On the spring-forward day, an hour is SKIPPED — in
//    America/Denver, 02:00 MST jumps to 03:00 MDT, so wall times 02:00–02:59
//    don't exist that day. If `timeOfDay` lands in this gap, we resolve to
//    the post-transition offset (the default in Luxon and date-fns-tz),
//    which means the event fires at a *different* wall-clock time than you
//    asked for — typically one hour earlier in real time. RECOMMENDATION:
//    don't pick `timeOfDay` between 02:00 and 02:59 in DST-observing zones.
//    03:00 is always safe.
//
// 2. TimeSpan spanning the gap. The TimeSpan type has two flavors:
//    `{type:"duration",ms}` — exact UTC milliseconds, no DST adjustment.
//      An 8h duration shift starting 23:00 spring-forward eve runs for
//      exactly 8h real time; the worker's wall display reads "9 hours
//      elapsed" because clocks jumped. Payroll-correct.
//    `{type:"hourSpan",hours}` — wall-clock hours, flexes with DST.
//      An 8h hourSpan shift starting 23:00 spring-forward eve ends at
//      07:00 next wall day regardless; real elapsed time is 7 actual
//      hours. Calendar-display correct.
//    Both are valid; pick based on whether you care about real elapsed
//    time or wall-clock display.

export enum Day {
  Sunday = 0,
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6,
}

export enum Month {
  January = 0,
  February = 1,
  March = 2,
  April = 3,
  May = 4,
  June = 5,
  July = 6,
  August = 7,
  September = 8,
  October = 9,
  November = 10,
  December = 11,
}

// Discriminated union over recurrence kinds. The union is exhaustively
// switched in the generators dispatcher; adding a new kind without wiring
// it in is a TS error, not a silent miss (this is the bug we removed from
// activity-board's IEventType-style hierarchy).
// Two conceptual modes:
//   Positional cascade — DaysOfWeek → WeeksOfMonth → MonthsOfYear
//     "Which slot in the calendar?" (weekday-anchored)
//   Numerical / date-indexed — Yearly, DaysOfMonth, DaysOfYear
//     "Which numbered day?" (date-anchored)
//
// Plus two single-occurrence kinds — Instant (one absolute UTC point) and
// LocalDateTime (one wall-clock point, DST-resolved in the template tz) — and
// Anchored (fixed-interval stepping from an absolute anchor).

// How long an occurrence lasts. Two flavors:
//   { type: "duration", ms }   — fixed real-elapsed time (UTC ms). An 8h
//                                duration is always 8h of wall-clock time
//                                EXCEPT when the wall clock jumps mid-shift
//                                — then the wall display shows ±1h.
//                                Payroll-correct.
//   { type: "hourSpan", hours } — wall-clock hours. An 8h hourSpan starting
//                                at 23:00 wall ends at 07:00 wall the next
//                                day, regardless of DST. Real elapsed time
//                                shrinks/expands by ±1h on DST nights.
//                                Calendar-display correct.
//
// hourSpan accepts fractional hours (e.g. 7.5 = 7h30m).
//
// When the template has no timezone, hourSpan collapses to
// `hours * 3_600_000` ms (no wall clock to flex against); with a timezone it
// flexes across DST. This holds for EVERY rule kind, including Instant and
// Anchored — their starts are absolute, but their spans still flex if a tz is
// set. When omitted from any rule, timeSpan defaults to
// { type: "duration", ms: 1 } so half-open window intersection still emits
// cron-fire events.
export type TimeSpan = { type: "duration"; ms: number } | { type: "hourSpan"; hours: number };

export type RecurrenceRule =
  | InstantRule
  | LocalDateTimeRule
  | AnchoredRule
  | DaysOfWeekRule
  | WeeksOfMonthRule
  | MonthsOfYearRule
  | YearlyRule
  | DaysOfMonthRule
  | DaysOfYearRule;

export interface InstantRule {
  kind: "instant";
  // Absolute UTC epoch ms — a single fixed point on the timeline. The template
  // timezone does NOT affect this start: an instant has no wall-clock
  // ambiguity to resolve, so there is no DST math to do on it. For a one-off
  // expressed in wall-clock terms ("09:00 on 8 Mar 2026 in America/Denver"),
  // use LocalDateTimeRule instead.
  startOn: number;
  // How long the occurrence lasts. Defaults to { type: "duration", ms: 1 }.
  // (Half-open intersection means a zero-length event wouldn't match any
  // window — we forbid that so cron-fire events still emit correctly.)
  // An hourSpan still flexes across DST when the template carries a timezone;
  // with no timezone it collapses to hours*3_600_000.
  timeSpan?: TimeSpan;
}

// A single occurrence expressed in WALL-CLOCK terms, resolved through the
// template timezone (DST-aware). Use this when a human picked a local date and
// time and you want the engine to resolve it to an instant — the inverse of
// InstantRule, which takes an already-absolute instant.
//
// Spring-forward gap / fall-back ambiguity on the start resolve to the earlier
// UTC instant, identical to every other wall-clock rule (see tz.ts). When the
// template has no timezone, the fields are interpreted as UTC.
//
// `day` is clamped to the month length (Feb 30 → Feb 28/29, Apr 31 → Apr 30),
// matching YearlyRule.
export interface LocalDateTimeRule {
  kind: "localDateTime";
  year: number;
  month: Month; // 0-indexed: 0 = January
  day: number; // 1..31, clamped to month length
  // Time-of-day in ms since wall-clock midnight (0 .. 86_400_000), interpreted
  // in the template's timezone.
  timeOfDay: number;
  // How long the occurrence lasts. Defaults to { type: "duration", ms: 1 }.
  // hourSpan flexes across DST (template tz); collapses to hours*3_600_000
  // when the template has no timezone.
  timeSpan?: TimeSpan;
}

export interface AnchoredRule {
  kind: "anchored";
  // Anchor moment in UTC epoch ms; recurrence steps from here.
  anchorDate: number;
  // Step in ms. Must be > 0 (validated at write time).
  intervalMs: number;
  // How long each occurrence lasts. Defaults to { type: "duration", ms: 1 }.
  // hourSpan is treated as hours*3_600_000 (no tz on Anchored).
  timeSpan?: TimeSpan;
  // Series window in UTC epoch ms. seriesStart bounds where occurrences
  // can start; seriesEnd === null means open-ended.
  seriesStart: number;
  seriesEnd: number | null;
  // Optional cap on number of occurrences emitted (counted from anchor).
  // null/undefined means unbounded (subject to seriesEnd).
  count?: number | null;
}

export interface DaysOfWeekRule {
  kind: "daysOfWeek";
  // Days the event repeats on. Non-empty.
  days: Day[];
  // 1 = every week, 2 = every other week, etc. Must be > 0.
  weekInterval: number;
  // Time-of-day in ms since wall-clock midnight (0 .. 86_400_000). Interpreted
  // in the template's timezone.
  timeOfDay: number;
  // How long each occurrence lasts. Defaults to { type: "duration", ms: 1 }.
  timeSpan?: TimeSpan;
  // Series bounds in UTC epoch ms.
  seriesStart: number;
  seriesEnd: number | null;
  count?: number | null;
}

export interface WeeksOfMonthRule {
  kind: "weeksOfMonth";
  // Days within the chosen weeks. Non-empty.
  days: Day[];
  // Which weeks of the month to fire on. Each entry: -5..-1 (nth from end)
  // or 1..5 (nth from start). 0 is invalid. Non-empty. Examples:
  //   [2]      → 2nd week
  //   [-1]     → last week
  //   [1, -1]  → first and last week
  //   [1, 3, 5]→ 1st, 3rd, 5th weeks (5th may not exist in some months)
  weeks: number[];
  // 1 = every month, 2 = every other month, etc. Must be > 0.
  monthInterval: number;
  timeOfDay: number;
  // How long each occurrence lasts. Defaults to { type: "duration", ms: 1 }.
  timeSpan?: TimeSpan;
  seriesStart: number;
  seriesEnd: number | null;
  count?: number | null;
}

// Positional yearly: months × weeks-of-month × weekdays.
// Top of the positional cascade. The fields parallel WeeksOfMonthRule
// (weeks + days), with `months` choosing which months within a year and
// `yearInterval` providing the cadence.
//
// Examples:
//   "1st Monday of Jan and Jul, every year"
//     months: [January, July], weeks: [1], days: [Monday], yearInterval: 1
//   "Last Friday of every quarter"
//     months: [March, June, September, December],
//     weeks: [-1], days: [Friday], yearInterval: 1
//   "2nd Sunday of May (Mother's Day) every year"
//     months: [May], weeks: [2], days: [Sunday], yearInterval: 1
//   "4th Thursday of November (Thanksgiving)"
//     months: [November], weeks: [4], days: [Thursday], yearInterval: 1
//
// If an Nth weekday doesn't exist in a given month (e.g. asking for the
// 5th Sunday in a month that has only 4), that occurrence is silently
// skipped — same behavior as WeeksOfMonthRule.
export interface MonthsOfYearRule {
  kind: "monthsOfYear";
  // Months to fire on. Non-empty.
  months: Month[];
  // Which weeks within the chosen months (1..5 or -5..-1, 0 invalid).
  weeks: number[];
  // Which weekdays. Non-empty. (Day enum: Sunday=0..Saturday=6.)
  days: Day[];
  // 1 = every year, 2 = every other year, etc. Must be > 0.
  yearInterval: number;
  timeOfDay: number;
  timeSpan?: TimeSpan;
  seriesStart: number;
  seriesEnd: number | null;
  count?: number | null;
}

// Simplest yearly recurrence: a single month and day-of-month. Reads
// cleanly for the overwhelmingly common case ("every June 11", "every
// other Jan 1"). For multi-date cases use DaysOfMonthRule.
//
// Feb 29 in non-leap years falls back to Feb 28. Day 30/31 in shorter
// months falls back to that month's last day.
export interface YearlyRule {
  kind: "yearly";
  month: Month;
  day: number; // 1..31, clamped to month length
  yearInterval: number;
  timeOfDay: number;
  timeSpan?: TimeSpan;
  seriesStart: number;
  seriesEnd: number | null;
  count?: number | null;
}

// Multiple day-of-month dates across multiple months.
//
// Examples:
//   "15th of Jan and Mar, every other year"
//     months: [January, March], daysOfMonth: [15], yearInterval: 2
//   "1st and 15th of every month (payroll)"
//     months: [Jan..Dec], daysOfMonth: [1, 15], yearInterval: 1
//   "Quarterly: 15th of Jan/Apr/Jul/Oct"
//     months: [Jan, Apr, Jul, Oct], daysOfMonth: [15], yearInterval: 1
//
// Day-of-month clamp: if a day doesn't exist in a given month
// (e.g. day 31 in April), falls back to the last day of that month.
// Sorting within a year is ascending by startTimestamp.
export interface DaysOfMonthRule {
  kind: "daysOfMonth";
  months: Month[]; // non-empty
  daysOfMonth: number[]; // each 1..31, non-empty
  yearInterval: number;
  timeOfDay: number;
  timeSpan?: TimeSpan;
  seriesStart: number;
  seriesEnd: number | null;
  count?: number | null;
}

// Day-of-year recurrence: "the Nth day(s) of the year".
//
// Day 1 = Jan 1. Day 60 = Mar 1 (in non-leap), Feb 29 (in leap).
// Day 366 only exists in leap years and is SKIPPED in non-leap years
// (unlike daysOfMonth, we don't clamp — "366th day" means literally
// that, and there's no obvious "last day of year" semantics worth the
// surprise).
//
// Examples:
//   "50th and 70th day of year (Feb 19 and Mar 11)"
//     daysOfYear: [50, 70], yearInterval: 1
//   "Day 1 (New Year's Day) and day 366 (last day of leap years)"
//     daysOfYear: [1, 366], yearInterval: 1  // day 366 emits only in leap years
export interface DaysOfYearRule {
  kind: "daysOfYear";
  daysOfYear: number[]; // each 1..366, non-empty
  yearInterval: number;
  timeOfDay: number;
  timeSpan?: TimeSpan;
  seriesStart: number;
  seriesEnd: number | null;
  count?: number | null;
}

// How to resolve a wall-clock time that is nonexistent (spring-forward gap)
// or ambiguous (fall-back overlap) in the template timezone. Mirrors the
// Temporal proposal's `disambiguation` option, plus a recurrence-friendly
// "skip".
//
//   "compatible" (default) — gap → the LATER instant (clock moves forward past
//                            the gap); overlap → the EARLIER instant. Matches
//                            Temporal, the JS Date constructor, and most
//                            operating systems.
//   "earlier"              — gap and overlap both resolve to the earlier
//                            instant. (This was the engine's behavior before
//                            disambiguation was configurable.)
//   "later"                — gap and overlap both resolve to the later instant.
//   "reject"               — throw on a nonexistent or ambiguous wall time.
//   "skip"                 — drop occurrences whose wall time is nonexistent (in
//                            a gap), keeping the rest of the series. Overlaps
//                            still resolve (to the earlier instant); only gaps
//                            are skipped.
export type Disambiguation = "compatible" | "earlier" | "later" | "reject" | "skip";

// A scheduled item the consumer cares about. The payload is opaque to the
// scheduler; the only contract is that it carries a `type` string so a
// dispatcher (or downstream consumer) can route on it.
export interface ScheduleTemplate<TPayload extends { type: string }> {
  id: string;
  rule: RecurrenceRule;
  // IANA timezone, e.g. "America/Denver". REQUIRED and validated at write time
  // (Scheduler.add/update reject unknown zones). Wall-clock rule fields
  // (timeOfDay, day-of-month, ...) are interpreted in this zone; use "UTC" for
  // zone-free scheduling. The absolute rules (instant, anchored) ignore it —
  // pass "UTC" there by convention.
  timezone: string;
  // Policy for resolving wall-clock times that fall in a DST gap or overlap.
  // Defaults to "compatible". See Disambiguation. Has no effect without a
  // timezone (UTC has no DST) or on absolute rules (instant, anchored), whose
  // starts carry no wall-clock ambiguity.
  disambiguation?: Disambiguation;
  payload: TPayload;
}

// Per-instance overrides. Identified by occurrenceKey rather than raw
// timestamp so editing timeOfDay on the template doesn't orphan alterations.
export interface Alteration<TPayload extends { type: string }> {
  id: string;
  templateId: string;
  occurrenceKey: string;
  kind: "reschedule" | "cancel";
  // For reschedule:
  startTimestamp?: number;
  timeSpan?: TimeSpan;
  // Optional payload patch merged onto the template payload at emit time.
  payloadOverride?: Partial<TPayload>;
}

// What the scheduler emits. References the template by id (not by value)
// so result lists stay light even for large windows.
export interface ScheduledEvent<TPayload extends { type: string }> {
  templateId: string;
  occurrenceKey: string;
  startTimestamp: number;
  endTimestamp: number;
  payload: TPayload;
  // Present iff this event came from (or was modified by) an alteration.
  alterationId?: string;
}
