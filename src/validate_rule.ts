import type { RecurrenceRule, TimeSpan } from "./types.js";

// ─── Rule validation ──────────────────────────────────────────
//
// A rule often comes from outside the type system: JSON in a database, a
// request body, or an LLM tool call. So validation checks the WHOLE shape —
// every required field present, of the right type, in range, and no fields
// the kind does not have — and throws an Error that names the field and the
// form it expects. A bad rule never reaches a generator, where it would crash
// with "Cannot read properties of undefined" or "Invalid time value".

const DAY_MS = 24 * 60 * 60 * 1000;

const DAYS_HINT = "Day numbers 0..6 (0=Sunday, 1=Monday … 6=Saturday)";
const MONTHS_HINT = "Month numbers 0..11 (0=January … 11=December)";
const WEEKS_HINT = "week-of-month numbers 1..5 (1=first) or -1..-5 (-1=last)";
const TIME_OF_DAY_HINT = "ms after local midnight, 0..86_399_999 (7:00 = 25_200_000)";
const TIMESTAMP_HINT = "a UTC timestamp in ms";

// One field of a rule kind: whether it must be there, and how to check it.
interface FieldSpec {
  required: boolean;
  check: (value: unknown, field: string) => void;
}

// The common series fields every repeating kind has.
const SERIES: Record<string, FieldSpec> = {
  timeSpan: { required: false, check: (v) => validateTimeSpan(v) },
  seriesStart: { required: true, check: timestamp },
  seriesEnd: { required: true, check: nullable(timestamp, "null (no end)") },
  count: {
    required: false,
    check: nullable(int(0, Number.MAX_SAFE_INTEGER, "a whole number >= 0"), "null"),
  },
};

const TIME_OF_DAY: FieldSpec = { required: true, check: int(0, DAY_MS - 1, TIME_OF_DAY_HINT) };

const KINDS: Record<RecurrenceRule["kind"], { name: string; fields: Record<string, FieldSpec> }> = {
  instant: {
    name: "InstantRule",
    fields: {
      startOn: { required: true, check: timestamp },
      timeSpan: { required: false, check: (v) => validateTimeSpan(v) },
    },
  },
  localDateTime: {
    name: "LocalDateTimeRule",
    fields: {
      year: { required: true, check: int(1, 9999, "a year such as 2026") },
      month: { required: true, check: int(0, 11, MONTHS_HINT) },
      day: { required: true, check: int(1, 31, "a day of the month 1..31") },
      timeOfDay: TIME_OF_DAY,
      timeSpan: { required: false, check: (v) => validateTimeSpan(v) },
    },
  },
  anchored: {
    name: "AnchoredRule",
    fields: {
      anchorDate: { required: true, check: timestamp },
      intervalMs: { required: true, check: positive("an interval in ms > 0") },
      ...SERIES,
    },
  },
  daysOfWeek: {
    name: "DaysOfWeekRule",
    fields: {
      days: { required: true, check: intList(0, 6, DAYS_HINT) },
      weekInterval: {
        required: true,
        check: int(1, Number.MAX_SAFE_INTEGER, "a whole number >= 1 (1 = every week)"),
      },
      timeOfDay: TIME_OF_DAY,
      ...SERIES,
    },
  },
  weeksOfMonth: {
    name: "WeeksOfMonthRule",
    fields: {
      days: { required: true, check: intList(0, 6, DAYS_HINT) },
      weeks: { required: true, check: weekList },
      monthInterval: {
        required: true,
        check: int(1, Number.MAX_SAFE_INTEGER, "a whole number >= 1 (1 = every month)"),
      },
      timeOfDay: TIME_OF_DAY,
      ...SERIES,
    },
  },
  monthsOfYear: {
    name: "MonthsOfYearRule",
    fields: {
      months: { required: true, check: intList(0, 11, MONTHS_HINT) },
      weeks: { required: true, check: weekList },
      days: { required: true, check: intList(0, 6, DAYS_HINT) },
      yearInterval: {
        required: true,
        check: int(1, Number.MAX_SAFE_INTEGER, "a whole number >= 1 (1 = every year)"),
      },
      timeOfDay: TIME_OF_DAY,
      ...SERIES,
    },
  },
  yearly: {
    name: "YearlyRule",
    fields: {
      month: { required: true, check: int(0, 11, MONTHS_HINT) },
      day: { required: true, check: int(1, 31, "a day of the month 1..31") },
      yearInterval: {
        required: true,
        check: int(1, Number.MAX_SAFE_INTEGER, "a whole number >= 1 (1 = every year)"),
      },
      timeOfDay: TIME_OF_DAY,
      ...SERIES,
    },
  },
  daysOfMonth: {
    name: "DaysOfMonthRule",
    fields: {
      months: { required: true, check: intList(0, 11, MONTHS_HINT) },
      daysOfMonth: { required: true, check: intList(1, 31, "days of the month 1..31") },
      yearInterval: {
        required: true,
        check: int(1, Number.MAX_SAFE_INTEGER, "a whole number >= 1 (1 = every year)"),
      },
      timeOfDay: TIME_OF_DAY,
      ...SERIES,
    },
  },
  daysOfYear: {
    name: "DaysOfYearRule",
    fields: {
      daysOfYear: { required: true, check: intList(1, 366, "days of the year 1..366") },
      yearInterval: {
        required: true,
        check: int(1, Number.MAX_SAFE_INTEGER, "a whole number >= 1 (1 = every year)"),
      },
      timeOfDay: TIME_OF_DAY,
      ...SERIES,
    },
  },
};

// The rule kinds, in the order the types declare them.
export const RULE_KINDS = Object.keys(KINDS) as RecurrenceRule["kind"][];

// Throws when `rule` is not a valid RecurrenceRule. The message names the
// first wrong field and the form it expects.
export function validateRule(rule: RecurrenceRule): void {
  const raw: unknown = rule;

  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) {
    throw new Error(`A rule must be an object with a "kind" (one of ${RULE_KINDS.join(", ")})`);
  }

  const obj = raw as Record<string, unknown>;
  const kind = KINDS[obj.kind as RecurrenceRule["kind"]];

  if (kind == null) {
    throw new Error(
      `Unknown rule kind ${JSON.stringify(obj.kind)} (expected one of ${RULE_KINDS.join(", ")})`
    );
  }

  const known = Object.keys(kind.fields);

  for (const key of Object.keys(obj)) {
    if (key !== "kind" && !known.includes(key)) {
      throw new Error(`${kind.name} has no field "${key}" (its fields are: ${known.join(", ")})`);
    }
  }

  for (const [field, spec] of Object.entries(kind.fields)) {
    const label = `${kind.name}.${field}`;

    if (obj[field] === undefined) {
      if (spec.required) throw new Error(`${label} is required: ${describe(spec, label)}`);
      continue;
    }

    spec.check(obj[field], label);
  }

  const seriesStart = obj.seriesStart as number | undefined;
  const seriesEnd = obj.seriesEnd as number | null | undefined;

  if (seriesStart != null && seriesEnd != null && seriesEnd <= seriesStart) {
    throw new Error(`${kind.name}.seriesEnd must be > seriesStart`);
  }
}

// Throws when `span` is not a TimeSpan. Undefined is valid (the rule's
// default span applies).
export function validateTimeSpan(span: unknown): asserts span is TimeSpan | undefined {
  if (span === undefined) return;

  const form =
    '{ "type": "duration", "ms": <ms >= 1> } or { "type": "hourSpan", "hours": <hours > 0> }';

  if (typeof span !== "object" || span == null) {
    throw new Error(`timeSpan must be ${form}`);
  }

  const s = span as Record<string, unknown>;

  if (s.type === "duration") {
    if (typeof s.ms !== "number" || !Number.isFinite(s.ms) || s.ms < 1) {
      throw new Error(`timeSpan.ms must be >= 1 if supplied (got ${String(s.ms)})`);
    }

    return;
  }

  if (s.type === "hourSpan") {
    if (typeof s.hours !== "number" || !Number.isFinite(s.hours) || s.hours <= 0) {
      throw new Error(`timeSpan.hours must be > 0 (got ${String(s.hours)})`);
    }

    return;
  }

  throw new Error(`timeSpan must be ${form} (got type ${JSON.stringify(s.type)})`);
}

// ─── Field checks ─────────────────────────────────────────────

// What the field should hold, for "is required" messages: each check is
// called on undefined and its message reused.
function describe(spec: FieldSpec, label: string): string {
  try {
    spec.check(undefined, label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const at = msg.indexOf(" must be ");

    if (at >= 0) return msg.slice(at + " must be ".length).replace(/ \(got [^)]*\)$/, "");
  }

  return "see the rule's type";
}

function show(v: unknown): string {
  return v === undefined ? "nothing" : JSON.stringify(v);
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function int(min: number, max: number, hint: string) {
  return (v: unknown, field: string): void => {
    if (!isInt(v) || v < min || v > max)
      throw new Error(`${field} must be ${hint} (got ${show(v)})`);
  };
}

function positive(hint: string) {
  return (v: unknown, field: string): void => {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      throw new Error(`${field} must be ${hint} (got ${show(v)})`);
    }
  };
}

function timestamp(v: unknown, field: string): void {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`${field} must be ${TIMESTAMP_HINT} (got ${show(v)})`);
  }
}

function nullable(check: (v: unknown, field: string) => void, nullHint: string) {
  return (v: unknown, field: string): void => {
    if (v === null) return;

    try {
      check(v, field);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      throw new Error(msg.replace(/ \(got /, ` or ${nullHint} (got `));
    }
  };
}

function intList(min: number, max: number, hint: string) {
  return (v: unknown, field: string): void => {
    const form = `a non-empty array of ${hint}`;

    if (!Array.isArray(v) || v.length === 0)
      throw new Error(`${field} must be ${form} (got ${show(v)})`);

    for (const x of v) {
      if (!isInt(x) || x < min || x > max) {
        throw new Error(`${field} must be ${form} (got ${show(v)}; ${show(x)} is out of range)`);
      }
    }
  };
}

function weekList(v: unknown, field: string): void {
  const form = `a non-empty array of ${WEEKS_HINT}`;

  if (!Array.isArray(v) || v.length === 0)
    throw new Error(`${field} must be ${form} (got ${show(v)})`);

  for (const w of v) {
    if (!isInt(w) || w === 0 || w < -5 || w > 5) {
      throw new Error(`${field} must be ${form} (got ${show(v)}; ${show(w)} is out of range)`);
    }
  }
}
