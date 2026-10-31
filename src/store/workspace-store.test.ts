import { beforeEach, describe, expect, it } from 'vitest';
import type { IdKind } from '@/core';
import { registry } from '@/registry';
import { createBoardStore, type BoardStore } from './board-store';
import { createWorkspaceStore, type WorkspaceStore } from './workspace-store';

function ids() {
  let i = 0;
  const prefix: Record<string, string> = {
    project: 'proj',
    board: 'board',
    snapshot: 'snap',
    node: 'node',
    edge: 'edge',
    group: 'grp',
  };
  return (k: IdKind) => `${prefix[k] ?? k}_${++i}`;
}

let board: BoardStore;
let ws: WorkspaceStore;
const w = () => ws.getState();
const b = () => board.getState();
const active = () => w().data.boards[w().activeBoardId]!;

function addNode(x = 0) {
  const r = b().dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x, y: 0 } });
  expect(r).toEqual({ ok: true });
}

beforeEach(() => {
  const newId = ids();
  board = createBoardStore({ registry, newId });
  ws = createWorkspaceStore({ boardStore: board, newId });
});

describe('workspace store ↔ board store', () => {
  it('starts with one board open', () => {
    expect(w().data.projects).toHaveLength(1);
    expect(active().name).toBe('Board 1');
    expect(b().doc.graph.nodes).toHaveLength(0);
  });

  it('writes board edits back into the workspace', () => {
    addNode();
    expect(active().graph.nodes).toHaveLength(1);
    expect(active().graph).toBe(b().doc.graph);
    b().dispatch({ type: 'updateScenario', patch: { peakMultiplier: 3 } });
    expect(active().scenario.peakMultiplier).toBe(3);
  });

  it('switching boards loads each board and keeps its own undo history', () => {
    const first = w().activeBoardId;
    addNode();
    addNode(200);
    const r = w().createBoard();
    expect(r.ok).toBe(true);
    expect(b().doc.graph.nodes).toHaveLength(0);
    expect(b().past).toHaveLength(0);
    addNode();

    w().openBoard(first);
    expect(b().doc.graph.nodes).toHaveLength(2);
    expect(b().past).toHaveLength(2);
    b().undo();
    expect(active().graph.nodes).toHaveLength(1);

    const second = w().data.projects[0]!.boardIds[1]!;
    w().openBoard(second);
    expect(b().doc.graph.nodes).toHaveLength(1);
    expect(w().data.boards[first]!.graph.nodes).toHaveLength(1);
  });

  it('opening a board is not an edit', () => {
    const before = w().data;
    w().createBoard();
    const afterCreate = w().data;
    w().openBoard(before.projects[0]!.boardIds[0]!);
    expect(w().data).toBe(afterCreate);
    expect(before).not.toBe(afterCreate);
  });

  it('deleting the open tab opens its neighbour', () => {
    w().createBoard();
    w().createBoard();
    const [one, two, three] = w().data.projects[0]!.boardIds;
    w().openBoard(two!);
    expect(w().deleteBoard(two!)).toEqual({ ok: true });
    expect(w().activeBoardId).toBe(three);
    w().deleteBoard(three!);
    expect(w().activeBoardId).toBe(one);
    const res = w().deleteBoard(one!);
    expect(res.ok).toBe(false);
    expect(w().lastError).toMatch(/at least one board/);
  });

  it('projects: create opens it; delete falls back; openProject remembers the last tab', () => {
    const firstProject = w().data.projects[0]!.id;
    w().createBoard();
    const remembered = w().activeBoardId;
    const r = w().createProject('Chat');
    if (!r.ok) throw new Error(r.reason);
    expect(w().activeBoardId).toBe(r.boardId);
    w().openProject(firstProject);
    expect(w().activeBoardId).toBe(remembered);
    w().openProject(r.projectId);
    w().deleteProject(r.projectId);
    expect(w().data.projects).toHaveLength(1);
    expect(w().data.projects[0]!.boardIds).toContain(w().activeBoardId);
  });

  it('snapshots: save, restore as one undo step, diff via data', () => {
    addNode();
    const s = w().saveSnapshot('One node');
    if (!s.ok) throw new Error(s.reason);
    addNode(200);
    addNode(400);
    expect(w().restoreSnapshot(s.snapshotId)).toEqual({ ok: true });
    expect(b().doc.graph.nodes).toHaveLength(1);
    expect(active().graph.nodes).toHaveLength(1);
    expect(b().past.at(-1)!.label).toBe('Restore "One node"');
    b().undo();
    expect(active().graph.nodes).toHaveLength(3);
    expect(w().deleteSnapshot(s.snapshotId)).toEqual({ ok: true });
    expect(active().snapshots).toHaveLength(0);
  });

  it('restore drops scenario flows/events that point at removed nodes', () => {
    const s = w().saveSnapshot('empty');
    if (!s.ok) throw new Error(s.reason);
    addNode();
    const nodeId = b().doc.graph.nodes[0]!.id;
    b().dispatch({
      type: 'updateScenario',
      patch: {
        flows: [
          { id: 'flow_1', name: 'Read', share: 1, rpsPerUser: 1, path: [{ nodeId, op: 'read' }] },
        ],
        events: [{ id: 'evt_1', kind: 'nodeOutage', atSec: 0, nodeId }],
      },
    });
    w().restoreSnapshot(s.snapshotId);
    expect(active().scenario.flows[0]!.path).toEqual([]);
    expect(active().scenario.events).toEqual([]);
  });

  it('replace() loads data and opens the requested board', () => {
    addNode();
    const data = w().data;
    const other = createWorkspaceStore({
      boardStore: createBoardStore({ registry }),
      newId: ids(),
    });
    other.getState().replace(data, data.projects[0]!.boardIds[0]);
    expect(other.getState().data.boards[other.getState().activeBoardId]!.graph.nodes).toHaveLength(
      1,
    );
  });

  it('group frames travel with the board', () => {
    addNode();
    const nodeId = b().doc.graph.nodes[0]!.id;
    b().dispatch({ type: 'group', memberIds: [nodeId], kind: 'vpc' });
    const groupId = b().doc.graph.groups[0]!.id;
    {
      b().dispatch({
        type: 'setGroupFrame',
        groupId,
        frame: { x: 0, y: 0, width: 400, height: 300 },
      });
      expect(w().data.layouts[w().activeBoardId]!.groupFrames[groupId]).toMatchObject({
        width: 400,
      });
      const first = w().activeBoardId;
      w().createBoard();
      w().openBoard(first);
      expect(b().doc.layout.groupFrames[groupId]).toMatchObject({ width: 400 });
    }
  });
});
