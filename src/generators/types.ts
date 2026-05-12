// Generators emit raw start/end pairs sorted ascending by startTimestamp.
// Stable per-occurrence keys are assigned downstream (occurrence_key.ts) so
// keys can be derived consistently across rule kinds.
export interface Occurrence {
  startTimestamp: number;
  endTimestamp: number;
}

// Hard ceiling per generate() call. A misconfigured rule (e.g. 1ms anchored
// interval over a year-long window) would otherwise produce billions of
// occurrences; we'd rather throw a clear error than blow heap.
export const MAX_OCCURRENCES_PER_GENERATE = 10_000;

export class TooManyOccurrencesError extends Error {
  constructor(kind: string) {
    super(
      `Generator '${kind}' would emit more than ${MAX_OCCURRENCES_PER_GENERATE} occurrences for the requested window. Narrow the window, increase the interval, or set 'count' on the rule.`
    );
    this.name = "TooManyOccurrencesError";
  }
}

// Half-open intersection: [startA, endA) overlaps [startB, endB)?
export function intersects(startA: number, endA: number, startB: number, endB: number): boolean {
  return Math.max(startA, startB) < Math.min(endA, endB);
}
