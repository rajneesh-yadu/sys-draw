import { beforeEach, describe, expect, it } from 'vitest';
import { BoardSchema, ProjectSchema, type Graph, type IdKind } from '@/core';
import {
  addSnapshot,
  boardsOfProject,
  createBoard,
  createProject,
  deleteBoard,
  deleteProject,
  deleteSnapshot,
  duplicateBoard,
  duplicateProject,
  emptyWorkspaceData,
  graphDiff,
  importBoards,
  importProjects,
  moveBoard,
  moveProject,
  normalizeWorkspace,
  renameBoard,
  renameProject,
  uniqueName,
  WorkspaceError,
  type WorkspaceData,
  type WorkspaceDeps,
} from './workspace';

const PREFIX: Record<string, string> = { project: 'proj', board: 'board', snapshot: 'snap' };
function makeDeps(): WorkspaceDeps {
  let i = 0;
  let t = 0;
  return {
    newId: (k: IdKind) => `${PREFIX[k] ?? k}_${++i}`,
    now: () => new Date(Date.UTC(2026, 9, 31, 12, 0, t++)).toISOString(),
  };
}

let deps: WorkspaceDeps;
let data: WorkspaceData;
const p0 = () => data.projects[0]!;
const names = (pid: string) => boardsOfProject(data, pid).map((b) => b.name);

beforeEach(() => {
  deps = makeDeps();
  data = emptyWorkspaceData(deps);
});

const graphWith = (...nodeIds: string[]): Graph => ({
  nodes: nodeIds.map((id, i) => ({
    id,
    defId: 'compute.app-server',
    label: id,
    position: { x: i, y: 0 },
    config: {},
    scaling: { replicas: 1, instanceType: 'small' },
  })),
  edges: [],
  groups: [],
});

describe('emptyWorkspaceData', () => {
  it('has one project with one empty board that pass core schemas', () => {
    expect(data.projects).toHaveLength(1);
    expect(p0().name).toBe('My project');
    const board = data.boards[p0().boardIds[0]!]!;
    expect(board.name).toBe('Board 1');
    expect(BoardSchema.safeParse(board).success).toBe(true);
    expect(ProjectSchema.safeParse(p0()).success).toBe(true);
    expect(data.layouts[board.id]).toEqual({ groupFrames: {} });
  });
});

describe('uniqueName', () => {
  it('appends the first free number, case-insensitively', () => {
    expect(uniqueName('A', [])).toBe('A');
    expect(uniqueName('A', ['a', 'A 2'])).toBe('A 3');
  });
});

describe('boards', () => {
  it('creates, renames, duplicates, reorders and deletes tabs', () => {
    const pid = p0().id;
    const first = p0().boardIds[0]!;
    let out = createBoard(data, deps, pid);
    data = out.data;
    expect(names(pid)).toEqual(['Board 1', 'Board 2']);

    data = renameBoard(data, deps, out.boardId, '  Cache layer  ');
    expect(names(pid)).toEqual(['Board 1', 'Cache layer']);
    expect(() => renameBoard(data, deps, out.boardId, '   ')).toThrow(WorkspaceError);

    out = duplicateBoard(data, deps, first);
    data = out.data;
    // Copy goes right after the original.
    expect(names(pid)).toEqual(['Board 1', 'Board 1 copy', 'Cache layer']);

    data = moveBoard(data, deps, out.boardId, 2);
    expect(names(pid)).toEqual(['Board 1', 'Cache layer', 'Board 1 copy']);

    data = deleteBoard(data, deps, first);
    expect(names(pid)).toEqual(['Cache layer', 'Board 1 copy']);
    expect(data.boards[first]).toBeUndefined();
    expect(data.layouts[first]).toBeUndefined();
  });

  it('refuses to delete the last board of a project', () => {
    expect(() => deleteBoard(data, deps, p0().boardIds[0]!)).toThrow(/at least one board/);
  });

  it('duplicates deeply (editing the copy does not touch the original)', () => {
    const id = p0().boardIds[0]!;
    data = {
      ...data,
      boards: { ...data.boards, [id]: { ...data.boards[id]!, graph: graphWith('node_a') } },
    };
    const out = duplicateBoard(data, deps, id);
    const copy = out.data.boards[out.boardId]!;
    expect(copy.graph).toEqual(data.boards[id]!.graph);
    expect(copy.graph).not.toBe(data.boards[id]!.graph);
  });

  it('keeps untouched boards as the same objects (for dirty tracking)', () => {
    const id = p0().boardIds[0]!;
    const before = data.boards[id];
    const out = createBoard(data, deps, p0().id);
    expect(out.data.boards[id]).toBe(before);
  });
});

describe('projects', () => {
  it('creates, renames, duplicates with boards, reorders and deletes', () => {
    let out = createProject(data, deps, 'Chat');
    data = out.data;
    const chat = out.projectId;
    expect(data.projects.map((p) => p.name)).toEqual(['My project', 'Chat']);
    data = createBoard(data, deps, chat).data;

    data = renameProject(data, deps, chat, 'Chat app');
    const dup = duplicateProject(data, deps, chat);
    data = dup.data;
    expect(data.projects.map((p) => p.name)).toEqual(['My project', 'Chat app', 'Chat app copy']);
    expect(names(dup.projectId)).toEqual(['Board 1', 'Board 2']);
    const copyBoards = boardsOfProject(data, dup.projectId);
    expect(copyBoards.every((b) => b.projectId === dup.projectId)).toBe(true);
    expect(copyBoards.map((b) => b.id)).not.toContain(data.projects[1]!.boardIds[0]);

    data = moveProject(data, dup.projectId, 0);
    expect(data.projects.map((p) => p.name)).toEqual(['Chat app copy', 'My project', 'Chat app']);

    const removed = data.projects[2]!.boardIds;
    data = deleteProject(data, chat);
    expect(data.projects.map((p) => p.name)).toEqual(['Chat app copy', 'My project']);
    removed.forEach((id) => expect(data.boards[id]).toBeUndefined());
    out = createProject(data, deps);
    expect(out.data.projects.at(-1)!.name).toBe('New project');
  });

  it('refuses to delete the only project', () => {
    expect(() => deleteProject(data, p0().id)).toThrow(/only project/);
  });

  it('bumps updatedAt on change', () => {
    const before = p0().updatedAt;
    data = renameProject(data, deps, p0().id, 'Renamed');
    expect(p0().updatedAt > before).toBe(true);
  });
});

describe('snapshots and diff', () => {
  it('saves, labels and deletes snapshots', () => {
    const id = p0().boardIds[0]!;
    let out = addSnapshot(data, deps, id);
    data = out.data;
    out = addSnapshot(data, deps, id, 'Before cache');
    data = out.data;
    expect(data.boards[id]!.snapshots.map((s) => s.label)).toEqual(['Snapshot 1', 'Before cache']);
    expect(BoardSchema.safeParse(data.boards[id]).success).toBe(true);
    data = deleteSnapshot(data, deps, id, out.snapshotId);
    expect(data.boards[id]!.snapshots).toHaveLength(1);
    expect(() => deleteSnapshot(data, deps, id, 'snap_nope')).toThrow(WorkspaceError);
  });

  it('snapshot graph is a copy', () => {
    const id = p0().boardIds[0]!;
    data = {
      ...data,
      boards: { ...data.boards, [id]: { ...data.boards[id]!, graph: graphWith('node_a') } },
    };
    const out = addSnapshot(data, deps, id);
    const b = out.data.boards[id]!;
    expect(b.snapshots[0]!.graph).toEqual(b.graph);
    expect(b.snapshots[0]!.graph).not.toBe(b.graph);
  });

  it('counts added, removed and changed items by id', () => {
    const a = graphWith('node_a', 'node_b', 'node_c');
    const b = graphWith('node_a', 'node_b', 'node_d', 'node_e');
    // node_b keeps index 1 → same position; node_a same; node_c removed; d, e added.
    expect(graphDiff(a, b)).toEqual({ added: 2, removed: 1, changed: 0, total: 3 });
    const moved = structuredClone(a);
    moved.nodes[0]!.position = { x: 99, y: 0 };
    expect(graphDiff(a, moved)).toEqual({ added: 0, removed: 0, changed: 1, total: 1 });
    expect(graphDiff(a, structuredClone(a)).total).toBe(0);
  });
});

describe('import', () => {
  it('keeps free ids and re-mints colliding ones; names made unique', () => {
    const pid = p0().id;
    const existing = data.boards[p0().boardIds[0]!]!;
    const fresh = { ...existing, id: 'board_fresh', name: 'Imported' };
    const clash = { ...existing, name: 'Board 1' };
    const out = importBoards(
      data,
      deps,
      { boards: [fresh, clash], layouts: { board_fresh: { groupFrames: {} } } },
      pid,
    );
    expect(out.boardIds[0]).toBe('board_fresh');
    expect(out.boardIds[1]).not.toBe(existing.id);
    data = out.data;
    expect(names(pid)).toEqual(['Board 1', 'Imported', 'Board 1 2']);
    expect(data.boards[out.boardIds[1]!]!.projectId).toBe(pid);
  });

  it('imports projects with their boards and re-mints colliding project ids', () => {
    const src = data;
    const out = importProjects(data, deps, {
      projects: src.projects,
      boards: Object.values(src.boards),
      layouts: src.layouts,
    });
    expect(out.data.projects).toHaveLength(2);
    const imported = out.data.projects[1]!;
    expect(imported.id).not.toBe(p0().id);
    expect(imported.name).toBe('My project 2');
    expect(imported.boardIds).toEqual(out.boardIds);
    expect(out.data.boards[out.boardIds[0]!]!.projectId).toBe(imported.id);
  });
});

describe('normalizeWorkspace', () => {
  it('returns the same object when already valid', () => {
    expect(normalizeWorkspace(data, deps)).toBe(data);
  });

  it('repairs dangling ids, empty projects and missing layouts', () => {
    const pid = p0().id;
    const broken: WorkspaceData = {
      ...data,
      projects: [{ ...p0(), boardIds: ['board_missing'] }],
      layouts: {},
    };
    const fixed = normalizeWorkspace(broken, deps);
    const ids = fixed.projects[0]!.boardIds;
    expect(ids).toHaveLength(1);
    expect(fixed.boards[ids[0]!]!.projectId).toBe(pid);
    expect(fixed.layouts[ids[0]!]).toEqual({ groupFrames: {} });
    // The original board was listed nowhere, so it is dropped.
    expect(Object.keys(fixed.boards)).toEqual(ids);
    expect(normalizeWorkspace({ ...data, projects: [] }, deps).projects).toHaveLength(1);
  });
});
