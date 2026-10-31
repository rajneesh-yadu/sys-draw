import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryAdapter, type MemoryAdapter } from './adapter';
import { boardFile, projectFile, serializeSaveFile, workspaceFile } from './save-file';
import { importSaveFile, openWorkspace } from './session';
import { addNode, makeStores } from './test-utils';

let adapter: MemoryAdapter;
beforeEach(() => {
  adapter = createMemoryAdapter();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('openWorkspace', () => {
  it('first run writes the default workspace', async () => {
    const { ws } = makeStores();
    const res = await openWorkspace(ws, adapter);
    expect(res.status).toBe('new');
    expect(adapter.state!.boards).toHaveLength(1);
    expect(adapter.state!.ui).toEqual({ activeBoardId: ws.getState().activeBoardId });
  });

  it('F9: two boards survive a "reload" exactly, and the last open board reopens', async () => {
    const a = makeStores();
    const s1 = await openWorkspace(a.ws, adapter, { delayMs: 10 });
    addNode(a.board);
    a.board.getState().dispatch({ type: 'updateScenario', patch: { peakMultiplier: 4 } });
    a.ws.getState().saveSnapshot('one');
    a.ws.getState().createBoard(undefined, 'Feed');
    addNode(a.board, 100);
    addNode(a.board, 300);
    const nodeId = a.board.getState().doc.graph.nodes[0]!.id;
    a.board.getState().dispatch({ type: 'group', memberIds: [nodeId], kind: 'region' });
    const g = a.board.getState().doc.graph.groups[0]!.id;
    a.board.getState().dispatch({
      type: 'setGroupFrame',
      groupId: g,
      frame: { x: 1, y: 2, width: 500, height: 400 },
    });
    await s1.autosave.stop();

    // "Reload": new stores (different id counter), same storage.
    const b = makeStores(1000);
    const s2 = await openWorkspace(b.ws, adapter);
    expect(s2.status).toBe('loaded');
    expect(b.ws.getState().data).toEqual(a.ws.getState().data);
    expect(b.ws.getState().activeBoardId).toBe(a.ws.getState().activeBoardId);
    expect(b.board.getState().doc.layout.groupFrames[g]).toEqual({
      x: 1,
      y: 2,
      width: 500,
      height: 400,
    });
    expect(b.board.getState().doc.graph.nodes).toHaveLength(2);
    await s2.autosave.stop();
  });

  it('upgrades stored v0 data, backs it up, and rewrites it at the current version', async () => {
    const a = makeStores();
    const s1 = await openWorkspace(a.ws, adapter);
    addNode(a.board);
    await s1.autosave.stop();
    const stored = adapter.state!;
    delete stored.workspace.schemaVersion;
    delete stored.workspace.settings;

    const b = makeStores(1000);
    const res = await openWorkspace(b.ws, adapter);
    expect(res.status).toBe('upgraded');
    expect(res.applied).toHaveLength(1);
    expect(adapter.backups).toHaveLength(1);
    expect(adapter.state!.workspace.schemaVersion).toBe(1);
    expect(b.board.getState().doc.graph.nodes).toHaveLength(1);
    await res.autosave.stop();
  });

  it('unreadable storage is backed up and replaced with a fresh workspace', async () => {
    adapter.state = { workspace: { schemaVersion: 1, projects: 'nope' }, boards: [] };
    const { ws } = makeStores();
    const res = await openWorkspace(ws, adapter);
    expect(res.status).toBe('reset');
    expect(adapter.backups[0]!.raw).toMatchObject({ workspace: { projects: 'nope' } });
    expect(adapter.state.boards).toHaveLength(1);
    await res.autosave.stop();
  });
});

describe('autosave', () => {
  it('debounces and writes only boards that changed', async () => {
    vi.useFakeTimers();
    const { ws, board } = makeStores();
    const res = await openWorkspace(ws, adapter, { delayMs: 500 });
    ws.getState().createBoard();
    await vi.advanceTimersByTimeAsync(600);
    const writes = adapter.writes;
    const spy = vi.spyOn(adapter, 'write');

    addNode(board);
    addNode(board, 100);
    expect(res.autosave.status.getState().state).toBe('pending');
    await vi.advanceTimersByTimeAsync(400);
    expect(adapter.writes).toBe(writes);
    await vi.advanceTimersByTimeAsync(200);
    expect(adapter.writes).toBe(writes + 1);
    expect(spy.mock.calls[0]![0].put.map((b) => b.id)).toEqual([ws.getState().activeBoardId]);
    expect(res.autosave.status.getState().state).toBe('saved');

    const gone = ws.getState().activeBoardId;
    ws.getState().deleteBoard(gone);
    await res.autosave.flush();
    expect(spy.mock.calls.at(-1)![0].remove).toEqual([gone]);
    expect(adapter.state!.boards.map((b) => b.id)).not.toContain(gone);
    await res.autosave.stop();
  });

  it('settings.autosave = false: changes wait for flush()', async () => {
    vi.useFakeTimers();
    const { ws, board } = makeStores();
    ws.getState().replace({
      ...ws.getState().data,
      settings: { ...ws.getState().data.settings, autosave: false },
    });
    const res = await openWorkspace(ws, adapter, { delayMs: 10 });
    const writes = adapter.writes;
    addNode(board);
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.writes).toBe(writes);
    await res.autosave.flush();
    expect(adapter.writes).toBe(writes + 1);
  });

  it('reports write errors and recovers on the next save', async () => {
    const { ws, board } = makeStores();
    const res = await openWorkspace(ws, adapter, { delayMs: 10_000 });
    const write = vi.spyOn(adapter, 'write').mockRejectedValueOnce(new Error('QuotaExceeded'));
    addNode(board);
    await res.autosave.flush();
    expect(res.autosave.status.getState()).toMatchObject({
      state: 'error',
      error: 'QuotaExceeded',
    });
    await res.autosave.flush();
    expect(res.autosave.status.getState().state).toBe('saved');
    expect(write).toHaveBeenCalledTimes(2);
    expect(adapter.state!.boards.find((b) => b.id === ws.getState().activeBoardId)).toBeDefined();
    // The board that failed to save is retried (it is still dirty).
    expect(write.mock.calls[1]![0].put).toHaveLength(1);
  });
});

describe('importSaveFile', () => {
  it('F9: an exported project re-imports on a fresh profile exactly', () => {
    const a = makeStores();
    addNode(a.board);
    a.ws.getState().createBoard(undefined, 'Two');
    addNode(a.board, 50);
    const text = serializeSaveFile(workspaceFile(a.ws.getState().data));

    const fresh = makeStores(5000);
    const res = importSaveFile(fresh.ws, text);
    expect(res.ok).toBe(true);
    const imported = fresh.ws.getState().data;
    const original = a.ws.getState().data;
    const p = original.projects[0]!;
    const q = imported.projects[1]!;
    expect(q.id).toBe(p.id);
    expect(q.boardIds).toEqual(p.boardIds);
    for (const id of p.boardIds) expect(imported.boards[id]).toEqual(original.boards[id]);
    // The imported project's first board is opened.
    expect(fresh.ws.getState().activeBoardId).toBe(p.boardIds[0]);
    expect(fresh.board.getState().doc.graph.nodes).toHaveLength(1);
  });

  it('a board file goes into the open project as a new tab; re-import makes a copy', () => {
    const a = makeStores();
    addNode(a.board);
    const bid = a.ws.getState().activeBoardId;
    const text = serializeSaveFile(boardFile(a.ws.getState().data, bid));
    const res = importSaveFile(a.ws, text);
    if (!res.ok) throw new Error(res.errors.join());
    expect(res.boardIds[0]).not.toBe(bid);
    const tabs = a.ws.getState().data.projects[0]!.boardIds;
    expect(tabs).toHaveLength(2);
    expect(a.ws.getState().data.boards[tabs[1]!]!.name).toBe('Board 1 2');
  });

  it('a project file adds a project', () => {
    const a = makeStores();
    const text = serializeSaveFile(
      projectFile(a.ws.getState().data, a.ws.getState().data.projects[0]!.id),
    );
    const res = importSaveFile(a.ws, text);
    expect(res).toMatchObject({ ok: true, kind: 'project' });
    expect(a.ws.getState().data.projects).toHaveLength(2);
  });

  it('an invalid file changes nothing', () => {
    const a = makeStores();
    const before = a.ws.getState().data;
    const res = importSaveFile(a.ws, '{"format":"sysdraw","kind":"board","boards":[]}');
    expect(res.ok).toBe(false);
    expect(a.ws.getState().data).toBe(before);
  });
});
