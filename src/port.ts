import type { Alteration, ScheduleTemplate } from "./types.js";

// Storage adapter for the Scheduler. The Scheduler is pure logic over this
// port; consumers implement it against whatever backing store they want
// (in-memory, SQL JSON column, KV, etc.).
//
// Range queries (start/end) MUST return any template/alteration that could
// produce or affect an occurrence in the window — including templates whose
// seriesStart is before `start` but whose recurrence still emits inside it.
// The simplest correct implementation returns all templates and lets the
// scheduler filter. Smarter ports may pre-filter on seriesStart/seriesEnd.
export interface SchedulerPort<TPayload extends { type: string }> {
  // Templates whose recurrence may emit occurrences intersecting [start, end).
  listTemplates(start: number, end: number): Promise<ScheduleTemplate<TPayload>[]>;
  getTemplate(id: string): Promise<ScheduleTemplate<TPayload> | null>;
  addTemplate(template: ScheduleTemplate<TPayload>): Promise<void>;
  // Replaces the entire stored template. The Scheduler validates before calling.
  updateTemplate(template: ScheduleTemplate<TPayload>): Promise<void>;
  removeTemplate(id: string): Promise<void>;

  // Alterations affecting occurrences in [start, end).
  listAlterations(start: number, end: number): Promise<Alteration<TPayload>[]>;
  // All alterations for a template (used when wiping on rule changes).
  listAlterationsByTemplate(templateId: string): Promise<Alteration<TPayload>[]>;
  addAlteration(alteration: Alteration<TPayload>): Promise<void>;
  removeAlteration(id: string): Promise<void>;
  // Bulk delete used by the Scheduler when a template's rule changes
  // (existing alterations are no longer meaningful — same policy as
  // activity-board, just made explicit).
  removeAlterationsForTemplate(templateId: string): Promise<void>;
}
