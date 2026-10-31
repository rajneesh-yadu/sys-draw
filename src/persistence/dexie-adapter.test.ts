import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createDexieAdapter } from './dexie-adapter';
import { openWorkspace } from './session';
import { addNode, makeStores } from './test-utils';

describe('Dexie adapter (fake IndexedDB)', () => {
  it('starts empty, writes, deletes and reads back', async () => {
    const a = createDexieAdapter('test-basic');
    expect(await a.read()).toBeNull();
    await a.write({
      workspace: { schemaVersion: 1 },
      put: [
        { id: 'board_a', board: { n: 1 }, layout: { groupFrames: {} } },
        { id: 'board_b', board: { n: 2 } },
      ],
      remove: [],
      ui: { activeBoardId: 'board_b' },
    });
    await a.write({ workspace: { schemaVersion: 1 }, put: [], remove: ['board_a'], ui: {} });
    const s = await a.read();
    expect(s).toEqual({
      workspace: { schemaVersion: 1 },
      boards: [{ id: 'board_b', board: { n: 2 } }],
      ui: {},
    });
    await a.replaceAll({ workspace: { schemaVersion: 1 }, boards: [], ui: {} });
    expect((await a.read())!.boards).toEqual([]);
    await a.backup({ any: 'thing' }, 'test');
    a.db.close();
  });

  it('full cycle: edit, autosave, reopen the database, everything is back', async () => {
    const a = makeStores();
    const s1 = await openWorkspace(a.ws, createDexieAdapter('test-cycle'), { delayMs: 5 });
    addNode(a.board);
    a.ws.getState().createBoard(undefined, 'Second');
    addNode(a.board, 100);
    await s1.autosave.stop();

    const b = makeStores(1000);
    const s2 = await openWorkspace(b.ws, createDexieAdapter('test-cycle'));
    expect(s2.status).toBe('loaded');
    expect(b.ws.getState().data).toEqual(a.ws.getState().data);
    await s2.autosave.stop();
  });
});
