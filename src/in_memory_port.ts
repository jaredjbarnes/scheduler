import type { SchedulerPort } from "./port";
import type { Alteration, ScheduleTemplate } from "./types";

// Reference port. Stores templates and alterations in plain Maps. Returns
// deep-cloned copies so callers can't mutate internal state.
//
// Range queries return everything and let the Scheduler filter — correct,
// but O(n) per query. A real backend would index on seriesStart/seriesEnd.
export class InMemorySchedulerPort<TPayload extends { type: string }>
  implements SchedulerPort<TPayload>
{
  private _templates = new Map<string, ScheduleTemplate<TPayload>>();
  private _alterations = new Map<string, Alteration<TPayload>>();

  async listTemplates(_start: number, _end: number): Promise<ScheduleTemplate<TPayload>[]> {
    return [...this._templates.values()].map(clone);
  }

  async getTemplate(id: string): Promise<ScheduleTemplate<TPayload> | null> {
    const t = this._templates.get(id);
    return t == null ? null : clone(t);
  }

  async addTemplate(template: ScheduleTemplate<TPayload>): Promise<void> {
    if (this._templates.has(template.id)) {
      throw new Error(`Template already exists: ${template.id}`);
    }
    this._templates.set(template.id, clone(template));
  }

  async updateTemplate(template: ScheduleTemplate<TPayload>): Promise<void> {
    if (!this._templates.has(template.id)) {
      throw new Error(`No template with id ${template.id}`);
    }
    this._templates.set(template.id, clone(template));
  }

  async removeTemplate(id: string): Promise<void> {
    this._templates.delete(id);
  }

  async listAlterations(_start: number, _end: number): Promise<Alteration<TPayload>[]> {
    return [...this._alterations.values()].map(clone);
  }

  async listAlterationsByTemplate(templateId: string): Promise<Alteration<TPayload>[]> {
    return [...this._alterations.values()].filter((a) => a.templateId === templateId).map(clone);
  }

  async addAlteration(alteration: Alteration<TPayload>): Promise<void> {
    if (this._alterations.has(alteration.id)) {
      throw new Error(`Alteration already exists: ${alteration.id}`);
    }
    this._alterations.set(alteration.id, clone(alteration));
  }

  async removeAlteration(id: string): Promise<void> {
    this._alterations.delete(id);
  }

  async removeAlterationsForTemplate(templateId: string): Promise<void> {
    for (const [id, a] of this._alterations) {
      if (a.templateId === templateId) this._alterations.delete(id);
    }
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
