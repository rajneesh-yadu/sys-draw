/**
 * IndexedDB via Dexie. Tables: `meta` (key → value: 'workspace', 'ui'), `boards` (one row per
 * board + its layout), `backups` (data that could not be loaded). The Dexie schema version below
 * is about table layout only; the document format is versioned by `schemaVersion` (core).
 */
import Dexie, { type Table } from 'dexie';
import type { StorageAdapter, StoredBoard, StoredUi, StoredWorkspace } from './adapter';

interface MetaRow {
  key: string;
  value: unknown;
}

interface BackupRow {
  id?: number;
  at: string;
  reason: string;
  raw: unknown;
}

class SysDrawDb extends Dexie {
  meta!: Table<MetaRow, string>;
  boards!: Table<StoredBoard, string>;
  backups!: Table<BackupRow, number>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ meta: 'key', boards: 'id', backups: '++id, at' });
  }
}

export const DEFAULT_DB_NAME = 'sysdraw';

export function createDexieAdapter(name: string = DEFAULT_DB_NAME): StorageAdapter & {
  db: Dexie;
} {
  const db = new SysDrawDb(name);
  const isRecord = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x);

  return {
    db,
    async read(): Promise<StoredWorkspace | null> {
      return db.transaction('r', db.meta, db.boards, async () => {
        const ws = await db.meta.get('workspace');
        if (!ws || !isRecord(ws.value)) return null;
        const ui = await db.meta.get('ui');
        return {
          workspace: ws.value,
          boards: await db.boards.toArray(),
          ui: isRecord(ui?.value) ? (ui.value as StoredUi) : undefined,
        };
      });
    },
    async write(change) {
      await db.transaction('rw', db.meta, db.boards, async () => {
        await db.meta.bulkPut([
          { key: 'workspace', value: change.workspace },
          { key: 'ui', value: change.ui },
        ]);
        if (change.put.length > 0) await db.boards.bulkPut(change.put);
        if (change.remove.length > 0) await db.boards.bulkDelete(change.remove);
      });
    },
    async replaceAll(state) {
      await db.transaction('rw', db.meta, db.boards, async () => {
        await db.boards.clear();
        await db.meta.bulkPut([
          { key: 'workspace', value: state.workspace },
          { key: 'ui', value: state.ui },
        ]);
        await db.boards.bulkPut(state.boards);
      });
    },
    async backup(raw, reason) {
      await db.backups.add({ at: new Date().toISOString(), reason, raw });
    },
  };
}
