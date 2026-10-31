/** Storage backends. IndexedDB (Dexie) in the app; an in-memory one for tests. */

/** What a backend holds: the workspace document, one row per board, and UI state. */
export interface StoredWorkspace {
  /** `{ schemaVersion, settings, projects }` — raw, migrated on load. */
  workspace: Record<string, unknown>;
  boards: StoredBoard[];
  ui?: StoredUi | undefined;
}

export interface StoredBoard {
  id: string;
  board: unknown;
  layout?: unknown;
}

/** Per-device UI state that is not part of the saved document. */
export interface StoredUi {
  activeBoardId?: string;
}

export interface StorageWrite {
  workspace: Record<string, unknown>;
  /** Boards to insert or replace. */
  put: StoredBoard[];
  /** Board ids to delete. */
  remove: string[];
  ui: StoredUi;
}

export interface StorageAdapter {
  /** Everything stored, or `null` on first run. */
  read(): Promise<StoredWorkspace | null>;
  /** Apply one change atomically. */
  write(change: StorageWrite): Promise<void>;
  /** Replace everything atomically (after a migration or repair). */
  replaceAll(state: StoredWorkspace & { ui: StoredUi }): Promise<void>;
  /** Keep a copy of data that could not be loaded as-is, so nothing is lost. */
  backup(raw: unknown, reason: string): Promise<void>;
}

/** In-memory adapter (tests, previews). `state` and `backups` are inspectable. */
export interface MemoryAdapter extends StorageAdapter {
  state: StoredWorkspace | null;
  backups: { raw: unknown; reason: string }[];
  writes: number;
}

export function createMemoryAdapter(initial: StoredWorkspace | null = null): MemoryAdapter {
  const clone = <T>(x: T): T => structuredClone(x);
  const adapter: MemoryAdapter = {
    state: initial === null ? null : clone(initial),
    backups: [],
    writes: 0,
    read() {
      return Promise.resolve(adapter.state === null ? null : clone(adapter.state));
    },
    write(change) {
      const boards = new Map((adapter.state?.boards ?? []).map((b) => [b.id, b]));
      for (const b of change.put) boards.set(b.id, clone(b));
      for (const id of change.remove) boards.delete(id);
      adapter.state = {
        workspace: clone(change.workspace),
        boards: [...boards.values()],
        ui: clone(change.ui),
      };
      adapter.writes++;
      return Promise.resolve();
    },
    replaceAll(state) {
      adapter.state = clone(state);
      adapter.writes++;
      return Promise.resolve();
    },
    backup(raw, reason) {
      adapter.backups.push({ raw: clone(raw), reason });
      return Promise.resolve();
    },
  };
  return adapter;
}
