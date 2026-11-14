import { Event, type IEventBroadcast } from "@j13b/state";
import { applyAlterations } from "./alterations.js";
import { generateAnchored } from "./generators/anchored.js";
import { generateDaysOfMonth } from "./generators/days_of_month.js";
import { generateDaysOfWeek } from "./generators/days_of_week.js";
import { generateDaysOfYear } from "./generators/days_of_year.js";
import { generateInstant } from "./generators/instant.js";
import { generateLocalDateTime } from "./generators/local_date_time.js";
import { generateMonthsOfYear } from "./generators/months_of_year.js";
import type { Occurrence } from "./generators/types.js";
import { generateWeeksOfMonth } from "./generators/weeks_of_month.js";
import { generateYearly } from "./generators/yearly.js";
import { assignOccurrenceKeys } from "./occurrence_key.js";
import type { SchedulerPort } from "./port.js";
import type {
  Alteration,
  Disambiguation,
  RecurrenceRule,
  ScheduleTemplate,
  ScheduledEvent,
  TimeSpan,
} from "./types.js";
import { isValidTimeZone } from "./tz.js";
import { validateRule, validateTimeSpan } from "./validate_rule.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Search horizon for next() / nextDue() before giving up. Five years covers
// every realistic use; if you need longer, call list() with an explicit
// window.
const NEXT_SEARCH_HORIZON_MS = 5 * 365 * DAY_MS;

export class Scheduler<TPayload extends { type: string }> {
  private readonly _port: SchedulerPort<TPayload>;
  // Fires after every successful write (add/update/remove/reschedule/cancel).
  // The Dispatcher subscribes via .changed so a new event added during a
  // sleep can interrupt the sleep and re-query nextDue().
  private readonly _changed = new Event<void>();

  constructor(port: SchedulerPort<TPayload>) {
    this._port = port;
  }

  get changed(): IEventBroadcast<void> {
    return this._changed.broadcast;
  }

  // ─── Reads ──────────────────────────────────────────────────

  // All occurrences whose [start, end) intersects [windowStart, windowEnd),
  // sorted ascending by startTimestamp. Honors alterations.
  async list(windowStart: number, windowEnd: number): Promise<ScheduledEvent<TPayload>[]> {
    if (windowEnd <= windowStart) return [];
    const [templates, alterations] = await Promise.all([
      this._port.listTemplates(windowStart, windowEnd),
      this._port.listAlterations(windowStart, windowEnd),
    ]);
    const out: ScheduledEvent<TPayload>[] = [];
    for (const tpl of templates) {
      const keyed = this._generateKeyed(tpl, windowStart, windowEnd);
      const events = applyAlterations(
        tpl.id,
        tpl.payload,
        keyed,
        alterations,
        tpl.timezone,
        windowStart,
        windowEnd
      );
      out.push(...events);
    }
    out.sort((a, b) => a.startTimestamp - b.startTimestamp);
    return out;
  }

  // Earliest occurrence of one template strictly after `after`. Returns null
  // if no occurrence exists within NEXT_SEARCH_HORIZON_MS.
  async next(templateId: string, after: number): Promise<ScheduledEvent<TPayload> | null> {
    const tpl = await this._port.getTemplate(templateId);
    if (tpl == null) return null;

    // Expanding-window search. Doubles each iteration until horizon.
    const horizonEnd = after + NEXT_SEARCH_HORIZON_MS;
    let windowStart = after;
    let windowSize = DAY_MS;
    while (windowStart < horizonEnd) {
      const windowEnd = Math.min(windowStart + windowSize, horizonEnd);
      const alterations = await this._port.listAlterationsByTemplate(templateId);
      const keyed = this._generateKeyed(tpl, windowStart, windowEnd);
      const events = applyAlterations(
        tpl.id,
        tpl.payload,
        keyed,
        alterations,
        tpl.timezone,
        windowStart,
        windowEnd
      );
      const firstAfter = events.find((e) => e.startTimestamp > after);
      if (firstAfter != null) return firstAfter;
      windowStart = windowEnd;
      windowSize = Math.min(windowSize * 2, 365 * DAY_MS);
    }
    return null;
  }

  // The next `limit` occurrences globally after `after`, sorted ascending.
  // Defaults to 10. Searches in expanding windows like next().
  async nextDue(after: number, limit = 10): Promise<ScheduledEvent<TPayload>[]> {
    if (limit <= 0) return [];
    const horizonEnd = after + NEXT_SEARCH_HORIZON_MS;
    const out: ScheduledEvent<TPayload>[] = [];
    let windowStart = after;
    let windowSize = DAY_MS;
    while (windowStart < horizonEnd && out.length < limit) {
      const windowEnd = Math.min(windowStart + windowSize, horizonEnd);
      const events = await this.list(windowStart, windowEnd);
      for (const e of events) {
        if (e.startTimestamp > after) {
          out.push(e);
          if (out.length >= limit) break;
        }
      }
      windowStart = windowEnd;
      windowSize = Math.min(windowSize * 2, 365 * DAY_MS);
    }
    return out;
  }

  // ─── Writes ─────────────────────────────────────────────────

  async add(template: ScheduleTemplate<TPayload>): Promise<void> {
    validateRule(template.rule);
    _validateTimezone(template.timezone);
    _validateDisambiguation(template.disambiguation);
    const normalized: ScheduleTemplate<TPayload> = {
      ...template,
      rule: _normalizeRule(template.rule),
    };
    await this._port.addTemplate(normalized);
    this._changed.notify();
  }

  // Partial update. Caller supplies any subset of the template fields plus
  // the id. If the rule changes (kind or any field), all alterations for
  // this template are wiped — same policy as activity-board, made explicit.
  async update(
    delta: { id: string } & Partial<Omit<ScheduleTemplate<TPayload>, "id">>
  ): Promise<void> {
    const existing = await this._port.getTemplate(delta.id);
    if (existing == null) throw new Error(`No template with id ${delta.id}`);
    const merged: ScheduleTemplate<TPayload> = {
      ...existing,
      ...delta,
      id: delta.id,
    };
    validateRule(merged.rule);
    _validateTimezone(merged.timezone);
    _validateDisambiguation(merged.disambiguation);
    const updated: ScheduleTemplate<TPayload> = {
      ...merged,
      rule: _normalizeRule(merged.rule),
    };
    const ruleChanged = !_rulesEqual(existing.rule, updated.rule);
    await this._port.updateTemplate(updated);
    if (ruleChanged) {
      await this._port.removeAlterationsForTemplate(updated.id);
    }
    this._changed.notify();
  }

  async remove(id: string): Promise<void> {
    await this._port.removeAlterationsForTemplate(id);
    await this._port.removeTemplate(id);
    this._changed.notify();
  }

  // Adds or replaces a reschedule alteration for the given occurrence.
  // Caller is responsible for providing a valid occurrenceKey (typically
  // taken from a prior list() result). If `newTimeSpan` is omitted, the
  // rescheduled occurrence inherits the original's UTC duration (i.e. moves
  // in time but keeps the same length).
  async reschedule(
    templateId: string,
    occurrenceKey: string,
    newStart: number,
    newTimeSpan?: TimeSpan,
    payloadOverride?: Partial<TPayload>
  ): Promise<string> {
    if (newTimeSpan != null) validateTimeSpan(newTimeSpan);
    const id = `alt-${templateId}-${occurrenceKey}-${Date.now()}`;
    await this._removeExistingAlteration(templateId, occurrenceKey);
    const alt: Alteration<TPayload> = {
      id,
      templateId,
      occurrenceKey,
      kind: "reschedule",
      startTimestamp: newStart,
      timeSpan: newTimeSpan,
      payloadOverride,
    };
    await this._port.addAlteration(alt);
    this._changed.notify();
    return id;
  }

  async cancel(templateId: string, occurrenceKey: string): Promise<string> {
    const id = `alt-${templateId}-${occurrenceKey}-${Date.now()}`;
    await this._removeExistingAlteration(templateId, occurrenceKey);
    const alt: Alteration<TPayload> = {
      id,
      templateId,
      occurrenceKey,
      kind: "cancel",
    };
    await this._port.addAlteration(alt);
    this._changed.notify();
    return id;
  }

  // ─── Internals ──────────────────────────────────────────────

  private _generateKeyed(tpl: ScheduleTemplate<TPayload>, windowStart: number, windowEnd: number) {
    const tz = tpl.timezone;
    const dis = tpl.disambiguation ?? "compatible";
    let occurrences: Occurrence[];
    switch (tpl.rule.kind) {
      case "instant":
        // Absolute start — no wall-clock ambiguity, disambiguation N/A.
        occurrences = generateInstant(tpl.rule, tz, windowStart, windowEnd);
        break;
      case "localDateTime":
        occurrences = generateLocalDateTime(tpl.rule, tz, windowStart, windowEnd, dis);
        break;
      case "anchored":
        // Absolute stepping — no wall-clock ambiguity, disambiguation N/A.
        occurrences = generateAnchored(tpl.rule, tz, windowStart, windowEnd);
        break;
      case "daysOfWeek":
        occurrences = generateDaysOfWeek(tpl.rule, tz, windowStart, windowEnd, dis);
        break;
      case "weeksOfMonth":
        occurrences = generateWeeksOfMonth(tpl.rule, tz, windowStart, windowEnd, dis);
        break;
      case "monthsOfYear":
        occurrences = generateMonthsOfYear(tpl.rule, tz, windowStart, windowEnd, dis);
        break;
      case "yearly":
        occurrences = generateYearly(tpl.rule, tz, windowStart, windowEnd, dis);
        break;
      case "daysOfMonth":
        occurrences = generateDaysOfMonth(tpl.rule, tz, windowStart, windowEnd, dis);
        break;
      case "daysOfYear":
        occurrences = generateDaysOfYear(tpl.rule, tz, windowStart, windowEnd, dis);
        break;
      default: {
        // Exhaustiveness guard — adding a new kind without handling it here
        // is a compile error.
        const _exhaustive: never = tpl.rule;
        throw new Error(`Unknown rule kind: ${JSON.stringify(_exhaustive)}`);
      }
    }
    return assignOccurrenceKeys(occurrences, tz);
  }

  private async _removeExistingAlteration(
    templateId: string,
    occurrenceKey: string
  ): Promise<void> {
    const existing = await this._port.listAlterationsByTemplate(templateId);
    for (const alt of existing) {
      if (alt.occurrenceKey === occurrenceKey) {
        await this._port.removeAlteration(alt.id);
      }
    }
  }
}

// ─── Validation ───────────────────────────────────────────────

// Returns a copy of `rule` with timeSpan defaulted when omitted, so
// generators don't have to handle undefined repeatedly.
function _normalizeRule(rule: RecurrenceRule): RecurrenceRule {
  if (rule.timeSpan != null) return rule;
  return { ...rule, timeSpan: { type: "duration", ms: 1 } };
}

function _validateTimezone(tz: string): void {
  if (typeof tz !== "string" || tz.length === 0) {
    throw new Error("ScheduleTemplate.timezone is required (use 'UTC' for zone-free scheduling)");
  }
  if (!isValidTimeZone(tz)) {
    throw new Error(`Unknown timezone '${tz}' (expected an IANA zone name or 'UTC')`);
  }
}

const _DISAMBIGUATIONS: readonly Disambiguation[] = [
  "compatible",
  "earlier",
  "later",
  "reject",
  "skip",
];

function _validateDisambiguation(d: Disambiguation | undefined): void {
  if (d == null) return;
  if (!_DISAMBIGUATIONS.includes(d)) {
    throw new Error(
      `Unknown disambiguation '${d}' (expected one of ${_DISAMBIGUATIONS.join(", ")})`
    );
  }
}

function _rulesEqual(a: RecurrenceRule, b: RecurrenceRule): boolean {
  return JSON.stringify(_canonicalize(a)) === JSON.stringify(_canonicalize(b));
}

function _canonicalize(rule: RecurrenceRule): unknown {
  // Sort + dedup any array selectors so reorderings or duplicates don't
  // false-flag a rule change (which would wipe alterations).
  if (rule.kind === "daysOfWeek") {
    return { ...rule, days: [...new Set(rule.days)].sort((a, b) => a - b) };
  }
  if (rule.kind === "weeksOfMonth") {
    return {
      ...rule,
      days: [...new Set(rule.days)].sort((a, b) => a - b),
      weeks: [...new Set(rule.weeks)].sort((a, b) => a - b),
    };
  }
  if (rule.kind === "monthsOfYear") {
    return {
      ...rule,
      months: [...new Set(rule.months)].sort((a, b) => a - b),
      weeks: [...new Set(rule.weeks)].sort((a, b) => a - b),
      days: [...new Set(rule.days)].sort((a, b) => a - b),
    };
  }
  if (rule.kind === "daysOfMonth") {
    return {
      ...rule,
      months: [...new Set(rule.months)].sort((a, b) => a - b),
      daysOfMonth: [...new Set(rule.daysOfMonth)].sort((a, b) => a - b),
    };
  }
  if (rule.kind === "daysOfYear") {
    return {
      ...rule,
      daysOfYear: [...new Set(rule.daysOfYear)].sort((a, b) => a - b),
    };
  }
  return rule;
}
