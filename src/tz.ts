import type { Day, Disambiguation, TimeSpan } from "./types";

const DAY_MS = 86_400_000;

// Timezone math built on Intl.DateTimeFormat (zero deps). All public functions
// take and return UTC epoch ms; `tz` is an IANA name (or "UTC", or omitted).
//
// The hard direction is wall-time → UTC, because Intl only gives us UTC →
// wall. We enumerate the candidate instants for a wall time by probing the
// zone offset one day before and one day after (which brackets any single DST
// transition), then keep the candidates that round-trip back to the input
// wall time. That yields 1 instant normally, 0 in a spring-forward gap, or 2
// in a fall-back overlap — the same approach Temporal uses.
//
// A `disambiguation` policy then picks among them (see the Disambiguation type
// in types.ts). The default, "compatible", sends a gap to the LATER instant
// and an overlap to the EARLIER instant — matching Temporal / the JS Date
// constructor / most operating systems. "skip" is handled by callers via
// isNonexistentWallTime(); wallTimeToUtc treats it as "compatible".

export interface WallParts {
  year: number;
  month: number; // 0-indexed: 0 = January
  day: number; // 1..31
  hour: number; // 0..23
  minute: number; // 0..59
  second: number; // 0..59
  ms: number; // 0..999
  dayOfWeek: Day;
}

const _formatterCache = new Map<string, Intl.DateTimeFormat>();

function _formatter(tz: string): Intl.DateTimeFormat {
  let f = _formatterCache.get(tz);
  if (f == null) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    _formatterCache.set(tz, f);
  }
  return f;
}

// Is `tz` an IANA zone name (or "UTC") the runtime recognizes? Constructing an
// Intl.DateTimeFormat with an unknown zone throws RangeError; we probe for that.
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format();
    return true;
  } catch {
    return false;
  }
}

export function utcToWallParts(utcEpochMs: number, tz = "UTC"): WallParts {
  if (tz === "UTC") {
    const d = new Date(utcEpochMs);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth(),
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      ms: d.getUTCMilliseconds(),
      dayOfWeek: d.getUTCDay() as Day,
    };
  }

  const parts = _formatter(tz).formatToParts(new Date(utcEpochMs));
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    if (p == null) throw new Error(`Missing date-time part '${type}' for tz '${tz}'`);
    return Number(p.value);
  };
  let hour = get("hour");
  if (hour === 24) hour = 0; // some Node versions report midnight as "24"
  const year = get("year");
  const month = get("month") - 1;
  const day = get("day");
  // Day-of-week derived from the wall date via UTC math (the math itself
  // is tz-independent — Date.UTC just gives us a zero-anchored instant).
  const dayOfWeek = new Date(Date.UTC(year, month, day)).getUTCDay() as Day;
  // Intl doesn't give us ms — preserve the original ms from utcEpochMs.
  // Sub-second precision is the same in any tz, since offsets are minute-
  // aligned (or, for a few historical zones, second-aligned).
  const ms = ((utcEpochMs % 1000) + 1000) % 1000;
  return {
    year,
    month,
    day,
    hour,
    minute: get("minute"),
    second: get("second"),
    ms,
    dayOfWeek,
  };
}

// Offset from UTC to local wall time at the given UTC instant, in ms.
// Positive for zones east of UTC. (wallAsUtc - utcInstant)
function _offsetMsAt(utcEpochMs: number, tz: string): number {
  if (tz === "UTC") return 0;
  const w = utcToWallParts(utcEpochMs, tz);
  const wallAsUtc = Date.UTC(w.year, w.month, w.day, w.hour, w.minute, w.second) + w.ms;
  return wallAsUtc - utcEpochMs;
}

// The instants that a wall time could map to in `tz`, plus the bracketing
// offsets. `valid` has length 1 normally, 0 in a spring-forward gap, or 2 in a
// fall-back overlap (sorted ascending).
function _possibleInstants(
  localUtc: number,
  tz: string
): { valid: number[]; offBefore: number; offAfter: number } {
  const offBefore = _offsetMsAt(localUtc - DAY_MS, tz);
  const offAfter = _offsetMsAt(localUtc + DAY_MS, tz);
  const valid: number[] = [];
  const offsets = offBefore === offAfter ? [offBefore] : [offBefore, offAfter];
  for (const off of offsets) {
    const epoch = localUtc - off;
    // Keep this candidate only if it reads back as the wall time we asked for
    // (a gap's candidates won't; an overlap's both will).
    const w = utcToWallParts(epoch, tz);
    const back = Date.UTC(w.year, w.month, w.day, w.hour, w.minute, w.second) + w.ms;
    if (back === localUtc && !valid.includes(epoch)) valid.push(epoch);
  }
  valid.sort((a, b) => a - b);
  return { valid, offBefore, offAfter };
}

// Is this wall time nonexistent (in a spring-forward gap) in `tz`? Used by the
// "skip" disambiguation to drop occurrences whose wall time doesn't exist.
export function isNonexistentWallTime(
  year: number,
  month: number,
  day: number,
  msOfDay: number,
  tz: string | undefined
): boolean {
  if (tz == null || tz === "UTC") return false;
  const localUtc = Date.UTC(year, month, day) + msOfDay;
  return _possibleInstants(localUtc, tz).valid.length === 0;
}

export function wallTimeToUtc(
  year: number,
  month: number, // 0-indexed
  day: number,
  msOfDay: number, // 0..86_399_999, ms since wall-clock midnight
  tz = "UTC",
  disambiguation: Disambiguation = "compatible"
): number {
  if (tz === "UTC") {
    return Date.UTC(year, month, day) + msOfDay;
  }
  const localUtc = Date.UTC(year, month, day) + msOfDay;
  const { valid, offBefore, offAfter } = _possibleInstants(localUtc, tz);

  if (valid.length === 1) return valid[0];

  if (valid.length === 2) {
    // Fall-back overlap. compatible/earlier/skip → earlier; later → later.
    if (disambiguation === "reject") {
      throw new Error(
        `Ambiguous wall time ${new Date(localUtc).toISOString().slice(0, 19)} in '${tz}' (fall-back overlap) with disambiguation "reject"`
      );
    }
    return disambiguation === "later" ? valid[1] : valid[0];
  }

  // Spring-forward gap (valid.length === 0). earlier → the earlier instant
  // (post-transition offset); compatible/later/skip → the later instant.
  // ("skip" only reaches here defensively — callers pre-check via
  // isNonexistentWallTime; we resolve it like "compatible".)
  if (disambiguation === "reject") {
    throw new Error(
      `Nonexistent wall time ${new Date(localUtc).toISOString().slice(0, 19)} in '${tz}' (spring-forward gap) with disambiguation "reject"`
    );
  }
  return disambiguation === "earlier" ? localUtc - offAfter : localUtc - offBefore;
}

export function dayOfWeekInTz(utcEpochMs: number, tz = "UTC"): Day {
  return utcToWallParts(utcEpochMs, tz).dayOfWeek;
}

// Add N calendar days in the wall-clock sense — important across DST
// boundaries, where one civil day is 23 or 25 hours, not 24.
export function addDaysInTz(utcEpochMs: number, days: number, tz = "UTC"): number {
  const w = utcToWallParts(utcEpochMs, tz);
  return wallTimeToUtc(w.year, w.month, w.day + days, _hmsToMs(w), tz);
}

export function addMonthsInTz(utcEpochMs: number, months: number, tz = "UTC"): number {
  const w = utcToWallParts(utcEpochMs, tz);
  return wallTimeToUtc(w.year, w.month + months, w.day, _hmsToMs(w), tz);
}

// Civil-calendar month length — tz-independent.
export function monthLength(year: number, month: number): number {
  // Date.UTC(y, m+1, 0) gives the last day of month `m` (0-indexed).
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// Returns endTimestamp for an occurrence given its start and a TimeSpan.
//
// For `duration`: pure UTC ms addition. The wall clock may show ±1h different
// elapsed time on DST nights, but real elapsed time is exactly `ms`.
//
// For `hourSpan`: add hours in wall-clock space (handles midnight crossing
// and DST flex). On a tz-less template, hourSpan collapses to hours*3_600_000
// since there's no wall clock to flex against.
//
// When span is undefined, defaults to 1ms (so the half-open intersection
// emits cron-fire occurrences correctly).
export function computeSpanEnd(
  startUtc: number,
  span: TimeSpan | undefined,
  tz: string | undefined
): number {
  if (span == null) return startUtc + 1;
  if (span.type === "duration") return startUtc + span.ms;
  // hourSpan
  if (tz == null) {
    // No tz → treat hours as a fixed real-time interval.
    return startUtc + span.hours * 3_600_000;
  }
  const w = utcToWallParts(startUtc, tz);
  const totalMs = _hmsToMs(w) + span.hours * 3_600_000;
  const daysAhead = Math.floor(totalMs / 86_400_000);
  const endMsInDay = totalMs - daysAhead * 86_400_000;
  return wallTimeToUtc(w.year, w.month, w.day + daysAhead, endMsInDay, tz);
}

function _hmsToMs(w: WallParts): number {
  return w.hour * 3_600_000 + w.minute * 60_000 + w.second * 1000 + w.ms;
}
