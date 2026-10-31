/**
 * Workspace data and its pure operations: projects, boards (tabs), snapshots, import merge.
 * Every op returns a new `WorkspaceData` and leaves untouched boards/layouts as the same objects,
 * so persistence can save only what changed (reference comparison). Ops throw `WorkspaceError`.
 */
import {
  DEFAULT_USER_SETTINGS,
  type Board,
  type Graph,
  type IdKind,
  type Project,
  type ProviderId,
  type Snapshot,
  type UserSettings,
} from '@/core';
import { defaultScenario, type BoardLayout } from './types';

export interface WorkspaceData {
  settings: UserSettings;
  /** Sidebar order. Each project's `boardIds` is its tab order. */
  projects: Project[];
  boards: Record<string, Board>;
  /** View-only layout per board (group frames), saved by persistence next to the board. */
  layouts: Record<string, BoardLayout>;
}

export interface WorkspaceDeps {
  newId: (kind: IdKind) => string;
  /** ISO-8601 timestamp. */
  now: () => string;
}

export class WorkspaceError extends Error {
  override name = 'WorkspaceError';
}

const fail = (msg: string): never => {
  throw new WorkspaceError(msg);
};

export const DEFAULT_PROJECT_NAME = 'My project';
export const DEFAULT_BOARD_PREFIX = 'Board';

// ---------- lookups ----------

export function requireProject(data: WorkspaceData, projectId: string): Project {
  return data.projects.find((p) => p.id === projectId) ?? fail(`Unknown project "${projectId}"`);
}

export function requireBoard(data: WorkspaceData, boardId: string): Board {
  return data.boards[boardId] ?? fail(`Unknown board "${boardId}"`);
}

/** The project that lists `boardId`, if any. */
export function projectOfBoard(data: WorkspaceData, boardId: string): Project | undefined {
  return data.projects.find((p) => p.boardIds.includes(boardId));
}

/** Boards of a project in tab order. */
export function boardsOfProject(data: WorkspaceData, projectId: string): Board[] {
  return requireProject(data, projectId)
    .boardIds.map((id) => data.boards[id])
    .filter((b): b is Board => b !== undefined);
}

// ---------- helpers ----------

function cleanName(name: string, what: string): string {
  const n = name.trim();
  if (n === '') fail(`${what} name must not be empty`);
  if (n.length > 120) fail(`${what} name must be at most 120 characters`);
  return n;
}

/** `base` if free, else `base 2`, `base 3`… (case-insensitive). */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  const [item] = out.splice(from, 1);
  if (item === undefined) return out;
  const clamped = Math.max(0, Math.min(to, out.length));
  out.splice(clamped, 0, item);
  return out;
}

function updateProject(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  projectId: string,
  patch: (p: Project) => Partial<Project>,
): WorkspaceData {
  const project = requireProject(data, projectId);
  const next: Project = { ...project, ...patch(project), updatedAt: deps.now() };
  return { ...data, projects: data.projects.map((p) => (p.id === projectId ? next : p)) };
}

function emptyLayout(): BoardLayout {
  return { groupFrames: {} };
}

/** A fresh, empty board (not yet added to any project). */
export function newBoard(
  deps: WorkspaceDeps,
  projectId: string,
  name: string,
  providerId: ProviderId = 'generic',
): Board {
  return {
    id: deps.newId('board'),
    projectId,
    name,
    providerId,
    mode: 'sandbox',
    graph: { nodes: [], edges: [], groups: [] },
    scenario: defaultScenario(),
    snapshots: [],
  };
}

function newProjectWithBoard(
  deps: WorkspaceDeps,
  name: string,
  providerId: ProviderId,
): { project: Project; board: Board } {
  const t = deps.now();
  const projectId = deps.newId('project');
  const board = newBoard(deps, projectId, `${DEFAULT_BOARD_PREFIX} 1`, providerId);
  return {
    project: { id: projectId, name, boardIds: [board.id], createdAt: t, updatedAt: t },
    board,
  };
}

/** One project with one empty board — the first-run workspace. */
export function emptyWorkspaceData(
  deps: WorkspaceDeps,
  settings: UserSettings = DEFAULT_USER_SETTINGS,
): WorkspaceData {
  const { project, board } = newProjectWithBoard(
    deps,
    DEFAULT_PROJECT_NAME,
    settings.defaultProviderId,
  );
  return {
    settings: { ...settings },
    projects: [project],
    boards: { [board.id]: board },
    layouts: { [board.id]: emptyLayout() },
  };
}

/**
 * Make loaded data safe to edit: drop board ids that have no board, give every project at least
 * one board, ensure at least one project, and a layout for every board. Returns the same object
 * when nothing needed fixing.
 */
export function normalizeWorkspace(data: WorkspaceData, deps: WorkspaceDeps): WorkspaceData {
  let changed = false;
  const boards = { ...data.boards };
  const layouts = { ...data.layouts };
  const projects = data.projects.map((p) => {
    let boardIds = p.boardIds.filter((id) => boards[id] !== undefined);
    if (boardIds.length === 0) {
      const b = newBoard(deps, p.id, `${DEFAULT_BOARD_PREFIX} 1`, data.settings.defaultProviderId);
      boards[b.id] = b;
      boardIds = [b.id];
    }
    if (boardIds.length !== p.boardIds.length || boardIds.some((id, i) => id !== p.boardIds[i])) {
      changed = true;
      return { ...p, boardIds };
    }
    return p;
  });
  // Boards no project lists are dropped.
  const listed = new Set(projects.flatMap((p) => p.boardIds));
  for (const id of Object.keys(boards)) {
    if (!listed.has(id)) {
      delete boards[id];
      changed = true;
    }
  }
  for (const id of Object.keys(layouts)) {
    if (!listed.has(id)) {
      delete layouts[id];
      changed = true;
    }
  }
  for (const id of listed) {
    if (layouts[id] === undefined) {
      layouts[id] = emptyLayout();
      changed = true;
    }
  }
  if (projects.length === 0) return emptyWorkspaceData(deps, data.settings);
  return changed ? { ...data, projects, boards, layouts } : data;
}

// ---------- projects ----------

export function createProject(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  name?: string,
): { data: WorkspaceData; projectId: string; boardId: string } {
  const finalName =
    name === undefined
      ? uniqueName(
          'New project',
          data.projects.map((p) => p.name),
        )
      : cleanName(name, 'Project');
  const { project, board } = newProjectWithBoard(deps, finalName, data.settings.defaultProviderId);
  return {
    data: {
      ...data,
      projects: [...data.projects, project],
      boards: { ...data.boards, [board.id]: board },
      layouts: { ...data.layouts, [board.id]: emptyLayout() },
    },
    projectId: project.id,
    boardId: board.id,
  };
}

export function renameProject(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  projectId: string,
  name: string,
): WorkspaceData {
  const n = cleanName(name, 'Project');
  if (requireProject(data, projectId).name === n) return data;
  return updateProject(data, deps, projectId, () => ({ name: n }));
}

/** Copy a project and all its boards (with snapshots and layouts); inserted after the original. */
export function duplicateProject(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  projectId: string,
): { data: WorkspaceData; projectId: string } {
  const src = requireProject(data, projectId);
  const t = deps.now();
  const id = deps.newId('project');
  const boards = { ...data.boards };
  const layouts = { ...data.layouts };
  const boardIds = src.boardIds.flatMap((bid) => {
    const b = data.boards[bid];
    if (!b) return [];
    const copy: Board = { ...structuredClone(b), id: deps.newId('board'), projectId: id };
    boards[copy.id] = copy;
    layouts[copy.id] = structuredClone(data.layouts[bid] ?? emptyLayout());
    return [copy.id];
  });
  const project: Project = {
    id,
    name: uniqueName(
      `${src.name} copy`,
      data.projects.map((p) => p.name),
    ),
    boardIds,
    createdAt: t,
    updatedAt: t,
  };
  const index = data.projects.indexOf(src);
  const projects = [...data.projects];
  projects.splice(index + 1, 0, project);
  return { data: { ...data, projects, boards, layouts }, projectId: id };
}

export function deleteProject(data: WorkspaceData, projectId: string): WorkspaceData {
  const project = requireProject(data, projectId);
  if (data.projects.length === 1) fail('Cannot delete the only project');
  const boards = { ...data.boards };
  const layouts = { ...data.layouts };
  for (const id of project.boardIds) {
    delete boards[id];
    delete layouts[id];
  }
  return { ...data, projects: data.projects.filter((p) => p.id !== projectId), boards, layouts };
}

/** Move a project to `toIndex` in the sidebar order. */
export function moveProject(
  data: WorkspaceData,
  projectId: string,
  toIndex: number,
): WorkspaceData {
  const from = data.projects.indexOf(requireProject(data, projectId));
  if (from === toIndex) return data;
  return { ...data, projects: moveItem(data.projects, from, toIndex) };
}

// ---------- boards ----------

export function createBoard(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  projectId: string,
  name?: string,
): { data: WorkspaceData; boardId: string } {
  const project = requireProject(data, projectId);
  const taken = boardsOfProject(data, projectId).map((b) => b.name);
  const finalName =
    name === undefined
      ? uniqueName(`${DEFAULT_BOARD_PREFIX} ${project.boardIds.length + 1}`, taken)
      : cleanName(name, 'Board');
  const board = newBoard(deps, projectId, finalName, data.settings.defaultProviderId);
  const next = updateProject(data, deps, projectId, (p) => ({
    boardIds: [...p.boardIds, board.id],
  }));
  return {
    data: {
      ...next,
      boards: { ...data.boards, [board.id]: board },
      layouts: { ...data.layouts, [board.id]: emptyLayout() },
    },
    boardId: board.id,
  };
}

/** Replace one board (and optionally its layout); bumps the owning project's `updatedAt`. */
export function putBoard(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  board: Board,
  layout?: BoardLayout,
): WorkspaceData {
  requireBoard(data, board.id);
  const project = projectOfBoard(data, board.id);
  const base = project ? updateProject(data, deps, project.id, () => ({})) : data;
  return {
    ...base,
    boards: { ...data.boards, [board.id]: board },
    layouts: layout === undefined ? data.layouts : { ...data.layouts, [board.id]: layout },
  };
}

export function renameBoard(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  boardId: string,
  name: string,
): WorkspaceData {
  const board = requireBoard(data, boardId);
  const n = cleanName(name, 'Board');
  if (board.name === n) return data;
  return putBoard(data, deps, { ...board, name: n });
}

/** Copy a board (graph, scenario, snapshots, layout) into the tab right after it. */
export function duplicateBoard(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  boardId: string,
): { data: WorkspaceData; boardId: string } {
  const src = requireBoard(data, boardId);
  const project = projectOfBoard(data, boardId) ?? fail(`Board "${boardId}" is in no project`);
  const copy: Board = {
    ...structuredClone(src),
    id: deps.newId('board'),
    name: uniqueName(
      `${src.name} copy`,
      boardsOfProject(data, project.id).map((b) => b.name),
    ),
  };
  const index = project.boardIds.indexOf(boardId);
  const next = updateProject(data, deps, project.id, (p) => {
    const ids = [...p.boardIds];
    ids.splice(index + 1, 0, copy.id);
    return { boardIds: ids };
  });
  return {
    data: {
      ...next,
      boards: { ...data.boards, [copy.id]: copy },
      layouts: {
        ...data.layouts,
        [copy.id]: structuredClone(data.layouts[boardId] ?? emptyLayout()),
      },
    },
    boardId: copy.id,
  };
}

export function deleteBoard(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  boardId: string,
): WorkspaceData {
  requireBoard(data, boardId);
  const project = projectOfBoard(data, boardId) ?? fail(`Board "${boardId}" is in no project`);
  if (project.boardIds.length === 1) {
    fail('A project needs at least one board — delete the project instead');
  }
  const next = updateProject(data, deps, project.id, (p) => ({
    boardIds: p.boardIds.filter((id) => id !== boardId),
  }));
  const boards = { ...data.boards };
  const layouts = { ...data.layouts };
  delete boards[boardId];
  delete layouts[boardId];
  return { ...next, boards, layouts };
}

/** Move a board to `toIndex` within its project's tabs. */
export function moveBoard(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  boardId: string,
  toIndex: number,
): WorkspaceData {
  requireBoard(data, boardId);
  const project = projectOfBoard(data, boardId) ?? fail(`Board "${boardId}" is in no project`);
  const from = project.boardIds.indexOf(boardId);
  if (from === toIndex) return data;
  return updateProject(data, deps, project.id, (p) => ({
    boardIds: moveItem(p.boardIds, from, toIndex),
  }));
}

// ---------- snapshots ----------

/** Save the board's current graph as a named snapshot (newest last). */
export function addSnapshot(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  boardId: string,
  label?: string,
): { data: WorkspaceData; snapshotId: string } {
  const board = requireBoard(data, boardId);
  const finalLabel =
    label === undefined || label.trim() === ''
      ? uniqueName(
          `Snapshot ${board.snapshots.length + 1}`,
          board.snapshots.map((s) => s.label),
        )
      : cleanName(label, 'Snapshot');
  const snap: Snapshot = {
    id: deps.newId('snapshot'),
    label: finalLabel,
    at: deps.now(),
    graph: structuredClone(board.graph),
  };
  return {
    data: putBoard(data, deps, { ...board, snapshots: [...board.snapshots, snap] }),
    snapshotId: snap.id,
  };
}

export function requireSnapshot(board: Board, snapshotId: string): Snapshot {
  return (
    board.snapshots.find((s) => s.id === snapshotId) ?? fail(`Unknown snapshot "${snapshotId}"`)
  );
}

export function deleteSnapshot(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  boardId: string,
  snapshotId: string,
): WorkspaceData {
  const board = requireBoard(data, boardId);
  requireSnapshot(board, snapshotId);
  return putBoard(data, deps, {
    ...board,
    snapshots: board.snapshots.filter((s) => s.id !== snapshotId),
  });
}

export interface GraphDiff {
  added: number;
  removed: number;
  changed: number;
  /** added + removed + changed */
  total: number;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual(ra[k], rb[k]));
}

/**
 * How many nodes, edges and groups differ going from `from` to `to`, matched by id.
 * `added` = in `to` only, `removed` = in `from` only, `changed` = same id, different content.
 */
export function graphDiff(from: Graph, to: Graph): GraphDiff {
  let added = 0;
  let removed = 0;
  let changed = 0;
  const lists = [
    [from.nodes, to.nodes],
    [from.edges, to.edges],
    [from.groups, to.groups],
  ] as const;
  for (const [a, b] of lists) {
    const before = new Map<string, unknown>(a.map((x) => [x.id, x]));
    const after = new Map<string, unknown>(b.map((x) => [x.id, x]));
    for (const [id, x] of after) {
      if (!before.has(id)) added++;
      else if (!deepEqual(before.get(id), x)) changed++;
    }
    for (const id of before.keys()) if (!after.has(id)) removed++;
  }
  return { added, removed, changed, total: added + removed + changed };
}

// ---------- import ----------

export interface ImportedBoards {
  boards: readonly Board[];
  layouts: Readonly<Record<string, BoardLayout>>;
}

export interface ImportedProjects extends ImportedBoards {
  projects: readonly Project[];
}

function takenIds(data: WorkspaceData): Set<string> {
  return new Set([...data.projects.map((p) => p.id), ...Object.keys(data.boards)]);
}

/** Keep `id` if it is free, else mint a new one. Records the id as taken. */
function claimId(taken: Set<string>, id: string, kind: IdKind, deps: WorkspaceDeps): string {
  let out = id;
  while (taken.has(out)) out = deps.newId(kind);
  taken.add(out);
  return out;
}

/**
 * Add boards to the end of `projectId`'s tabs. Board ids are kept when free (so a re-import on a
 * fresh profile is identical) and re-minted on collision; names are made unique in the project.
 */
export function importBoards(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  incoming: ImportedBoards,
  projectId: string,
): { data: WorkspaceData; boardIds: string[] } {
  requireProject(data, projectId);
  const taken = takenIds(data);
  const names = boardsOfProject(data, projectId).map((b) => b.name);
  const boards = { ...data.boards };
  const layouts = { ...data.layouts };
  const ids: string[] = [];
  for (const b of incoming.boards) {
    const id = claimId(taken, b.id, 'board', deps);
    const name = uniqueName(b.name, names);
    names.push(name);
    boards[id] = { ...structuredClone(b), id, projectId, name };
    layouts[id] = structuredClone(incoming.layouts[b.id] ?? emptyLayout());
    ids.push(id);
  }
  const next = updateProject(data, deps, projectId, (p) => ({ boardIds: [...p.boardIds, ...ids] }));
  return { data: { ...next, boards, layouts }, boardIds: ids };
}

/** Add whole projects (with their boards) after the existing ones. Ids kept when free. */
export function importProjects(
  data: WorkspaceData,
  deps: WorkspaceDeps,
  incoming: ImportedProjects,
): { data: WorkspaceData; projectIds: string[]; boardIds: string[] } {
  const taken = takenIds(data);
  const byId = new Map(incoming.boards.map((b) => [b.id, b]));
  const projectNames = data.projects.map((p) => p.name);
  const boards = { ...data.boards };
  const layouts = { ...data.layouts };
  const projects = [...data.projects];
  const projectIds: string[] = [];
  const allBoardIds: string[] = [];
  const t = deps.now();
  for (const p of incoming.projects) {
    const pid = claimId(taken, p.id, 'project', deps);
    const boardIds: string[] = [];
    for (const oldId of p.boardIds) {
      const b = byId.get(oldId);
      if (!b) continue;
      const bid = claimId(taken, b.id, 'board', deps);
      boards[bid] = { ...structuredClone(b), id: bid, projectId: pid };
      layouts[bid] = structuredClone(incoming.layouts[oldId] ?? emptyLayout());
      boardIds.push(bid);
    }
    const name = uniqueName(p.name, projectNames);
    projectNames.push(name);
    projects.push({ ...p, id: pid, name, boardIds, updatedAt: t });
    projectIds.push(pid);
    allBoardIds.push(...boardIds);
  }
  const next = normalizeWorkspace({ ...data, projects, boards, layouts }, deps);
  return { data: next, projectIds, boardIds: allBoardIds };
}
