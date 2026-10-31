/** Shared helpers for persistence tests (not exported from index.ts). */
import type { IdKind } from '@/core';
import { createAppStores, type BoardStore, type WorkspaceStore } from '@/store';

export function counterIds(start = 0) {
  let i = start;
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

export function makeStores(idStart = 0): { board: BoardStore; ws: WorkspaceStore } {
  const { boardStore, workspaceStore } = createAppStores({ newId: counterIds(idStart) });
  return { board: boardStore, ws: workspaceStore };
}

export function addNode(board: BoardStore, x = 0) {
  const r = board
    .getState()
    .dispatch({ type: 'addNode', defId: 'compute.app-server', position: { x, y: 0 } });
  if (!r.ok) throw new Error(r.reason);
  return board.getState().doc.graph.nodes.at(-1)!.id;
}
