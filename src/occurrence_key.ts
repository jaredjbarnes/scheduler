import type { Occurrence } from "./generators/types.js";
import { utcToWallParts } from "./tz.js";

// A key identifies a specific occurrence within a template's series. It must
// be:
//   - Stable across small rule edits (e.g. tweaking timeOfDay)
//   - Unique within a single generate() call's output for one template
//
// Format: `YYYY-MM-DD` (in the template's tz), with `#N` suffix when multiple
// occurrences land on the same calendar day. Index is 0-based by emission
// order within that day.
//
// Trade-off: changing timeOfDay across the date boundary moves an event to
// a different day, which orphans alterations on it. We accept that as the
// cost of human-readable, edit-tolerant keys. Same goes for timezone changes.

export interface KeyedOccurrence extends Occurrence {
  occurrenceKey: string;
}

export function assignOccurrenceKeys(
  occurrences: readonly Occurrence[],
  tz: string | undefined
): KeyedOccurrence[] {
  const counts = new Map<string, number>();
  return occurrences.map((occ) => {
    const w = utcToWallParts(occ.startTimestamp, tz);
    const date = `${_pad4(w.year)}-${_pad2(w.month + 1)}-${_pad2(w.day)}`;
    const idx = counts.get(date) ?? 0;
    counts.set(date, idx + 1);
    const occurrenceKey = idx === 0 ? date : `${date}#${idx}`;
    return { ...occ, occurrenceKey };
  });
}

function _pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function _pad4(n: number): string {
  return n < 10 ? `000${n}` : n < 100 ? `00${n}` : n < 1000 ? `0${n}` : String(n);
}
