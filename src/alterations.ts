import { intersects } from "./generators/types.js";
import type { KeyedOccurrence } from "./occurrence_key.js";
import type { Alteration, ScheduledEvent } from "./types.js";
import { computeSpanEnd } from "./tz.js";

// Apply a template's alterations to its base occurrences and emit the final
// ScheduledEvents.
//
// Two passes:
//   1. Walk base occurrences. Cancel suppresses; reschedule replaces (and
//      may move out of window, in which case it's not emitted).
//   2. Walk reschedules whose original key is NOT in the base list (the
//      original was outside the window) but whose new time IS in the window.
//      Synthesize an event for them. This is what activity-board does in its
//      separate AlterationEventGenerator.
//
// `tz` is the template's timezone. Used to interpret hourSpan on the
// alteration's timeSpan (if any). When the alteration carries no timeSpan,
// we preserve the original occurrence's duration (end - start in UTC ms).
//
// Result is sorted ascending by startTimestamp.
export function applyAlterations<TPayload extends { type: string }>(
  templateId: string,
  basePayload: TPayload,
  keyedOccurrences: readonly KeyedOccurrence[],
  alterations: readonly Alteration<TPayload>[],
  tz: string | undefined,
  windowStart: number,
  windowEnd: number
): ScheduledEvent<TPayload>[] {
  // Index alterations for THIS template by occurrence key. If multiple
  // alterations target the same key, last-write-wins.
  const altByKey = new Map<string, Alteration<TPayload>>();
  for (const alt of alterations) {
    if (alt.templateId === templateId) altByKey.set(alt.occurrenceKey, alt);
  }

  const out: ScheduledEvent<TPayload>[] = [];
  const seenKeys = new Set<string>();

  for (const occ of keyedOccurrences) {
    seenKeys.add(occ.occurrenceKey);
    const alt = altByKey.get(occ.occurrenceKey);

    if (alt == null) {
      out.push({
        templateId,
        occurrenceKey: occ.occurrenceKey,
        startTimestamp: occ.startTimestamp,
        endTimestamp: occ.endTimestamp,
        payload: basePayload,
      });
      continue;
    }
    if (alt.kind === "cancel") continue;

    // reschedule
    const start = alt.startTimestamp ?? occ.startTimestamp;
    // If the alteration specifies a timeSpan, use it (with tz semantics).
    // Otherwise preserve the original UTC duration.
    const end =
      alt.timeSpan != null
        ? computeSpanEnd(start, alt.timeSpan, tz)
        : start + (occ.endTimestamp - occ.startTimestamp);
    if (!intersects(start, end, windowStart, windowEnd)) continue;
    out.push({
      templateId,
      occurrenceKey: occ.occurrenceKey,
      startTimestamp: start,
      endTimestamp: end,
      payload: _mergePayload(basePayload, alt.payloadOverride),
      alterationId: alt.id,
    });
  }

  // Orphan reschedules: alteration's occurrenceKey isn't in the base list
  // (because the original fell outside the window) but the rescheduled time
  // is. Cancels for orphans are no-ops — there was nothing to cancel here.
  for (const alt of altByKey.values()) {
    if (seenKeys.has(alt.occurrenceKey)) continue;
    if (alt.kind !== "reschedule") continue;
    if (alt.startTimestamp == null) continue;
    // No original to inherit duration from; default to 1ms if no timeSpan.
    const end =
      alt.timeSpan != null
        ? computeSpanEnd(alt.startTimestamp, alt.timeSpan, tz)
        : alt.startTimestamp + 1;
    if (!intersects(alt.startTimestamp, end, windowStart, windowEnd)) continue;
    out.push({
      templateId,
      occurrenceKey: alt.occurrenceKey,
      startTimestamp: alt.startTimestamp,
      endTimestamp: end,
      payload: _mergePayload(basePayload, alt.payloadOverride),
      alterationId: alt.id,
    });
  }

  return out.sort((a, b) => a.startTimestamp - b.startTimestamp);
}

function _mergePayload<TPayload extends { type: string }>(
  base: TPayload,
  override: Partial<TPayload> | undefined
): TPayload {
  if (override == null) return base;
  return { ...base, ...override } as TPayload;
}
