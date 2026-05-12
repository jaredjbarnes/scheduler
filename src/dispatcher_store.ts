// Persistence for the Dispatcher's tick cursor. The cursor is a single
// epoch-ms value: the last instant for which the Dispatcher has fired all
// due events. On restart, the Dispatcher catches up by listing events in
// [cursor, now) and firing them — so a process crash followed by restart
// won't lose events that were due during downtime.
//
// Same shape as ChatStore / MemoryStore in the agent module — implement
// against whatever backend you want.
export interface DispatcherStore {
  loadCursor(): Promise<number | null>;
  saveCursor(cursor: number): Promise<void>;
}

// Reference in-memory implementation. Useful for tests and short-lived
// processes that don't need crash recovery.
export class InMemoryDispatcherStore implements DispatcherStore {
  private _cursor: number | null = null;

  async loadCursor(): Promise<number | null> {
    return this._cursor;
  }

  async saveCursor(cursor: number): Promise<void> {
    this._cursor = cursor;
  }
}
