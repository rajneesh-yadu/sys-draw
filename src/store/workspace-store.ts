/**
 * The workspace store: projects, board tabs, snapshots and import, on top of the pure ops in
 * workspace.ts. It owns which board is open and keeps the (single) board store in sync:
 * opening a board loads it into the board store; every board-store edit is written back here.
 * Undo history is kept per board while the app runs.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { newId as coreNewId, type IdKind } from '@/core';
import type { BoardStore, HistoryEntry } from './board-store';
import {
  addSnapshot,
  createBoard,
  createProject,
  deleteBoard,
  deleteProject,
  deleteSnapshot,
  duplicateBoard,
  duplicateProject,
  emptyWorkspaceData,
  importBoards,
  importProjects,
  moveBoard,
  moveProject,
  normalizeWorkspace,
  projectOfBoard,
  putBoard,
  renameBoard,
  renameProject,
  requireBoard,
  requireProject,
  requireSnapshot,
  WorkspaceError,
  type ImportedBoards,
  type ImportedProjects,
  type WorkspaceData,
  type WorkspaceDeps,
} from './workspace';

export type WorkspaceResult<T extends object = object> =
  ({ ok: true } & T) | { ok: false; reason: string };

export interface WorkspaceState {
  data: WorkspaceData;
  /** The board open in the board store. Always a board of `data`. */
  activeBoardId: string;
  /** Error from the last failed action, for a status line. */
  lastError: string | null;

  /** Replace everything (load from storage). Opens `activeBoardId` if it exists, else the first board. */
  replace(data: WorkspaceData, activeBoardId?: string): void;
  openBoard(boardId: string): WorkspaceResult;
  /** Open the board last used in that project (or its first tab). */
  openProject(projectId: string): WorkspaceResult;

  createProject(name?: string): WorkspaceResult<{ projectId: string; boardId: string }>;
  renameProject(projectId: string, name: string): WorkspaceResult;
  duplicateProject(projectId: string): WorkspaceResult<{ projectId: string }>;
  deleteProject(projectId: string): WorkspaceResult;
  moveProject(projectId: string, toIndex: number): WorkspaceResult;

  /** New board at the end of `projectId` (default: the active project); opens it. */
  createBoard(projectId?: string, name?: string): WorkspaceResult<{ boardId: string }>;
  renameBoard(boardId: string, name: string): WorkspaceResult;
  duplicateBoard(boardId: string): WorkspaceResult<{ boardId: string }>;
  deleteBoard(boardId: string): WorkspaceResult;
  moveBoard(boardId: string, toIndex: number): WorkspaceResult;

  /** Snapshot the active board (or `boardId`). */
  saveSnapshot(label?: string, boardId?: string): WorkspaceResult<{ snapshotId: string }>;
  /** Restore a snapshot of the active board as one undoable edit. */
  restoreSnapshot(snapshotId: string): WorkspaceResult;
  deleteSnapshot(snapshotId: string, boardId?: string): WorkspaceResult;

  /** Add imported boards to a project (default: active) and open the first. */
  importBoards(
    incoming: ImportedBoards,
    projectId?: string,
  ): WorkspaceResult<{ boardIds: string[] }>;
  /** Add imported projects and open the first imported board. */
  importProjects(
    incoming: ImportedProjects,
  ): WorkspaceResult<{ projectIds: string[]; boardIds: string[] }>;

  clearError(): void;
}

export type WorkspaceStore = StoreApi<WorkspaceState>;

export interface WorkspaceStoreOptions {
  boardStore: BoardStore;
  newId?: (kind: IdKind) => string;
  now?: () => string;
  initial?: WorkspaceData;
}

export function createWorkspaceStore(opts: WorkspaceStoreOptions): WorkspaceStore {
  const deps: WorkspaceDeps = {
    newId: opts.newId ?? ((k) => coreNewId(k)),
    now: opts.now ?? (() => new Date().toISOString()),
  };
  const boardStore = opts.boardStore;
  const histories = new Map<string, { past: HistoryEntry[]; future: HistoryEntry[] }>();
  const lastBoardOfProject = new Map<string, string>();
  /** True while we load a board into the board store (its change is not an edit). */
  let loading = false;

  const initialData = normalizeWorkspace(opts.initial ?? emptyWorkspaceData(deps), deps);
  const firstBoardId = (d: WorkspaceData) => d.projects[0]?.boardIds[0] ?? '';

  const store = createStore<WorkspaceState>()((set, get) => {
    /** Load `boardId` into the board store, stashing the current board's undo history. */
    function show(data: WorkspaceData, boardId: string, stashCurrent: boolean) {
      const prevId = get().activeBoardId;
      if (stashCurrent && prevId !== undefined && data.boards[prevId] !== undefined) {
        const { past, future } = boardStore.getState();
        histories.set(prevId, { past, future });
      }
      const board = requireBoard(data, boardId);
      loading = true;
      try {
        boardStore.getState().load({
          graph: board.graph,
          providerId: board.providerId,
          layout: data.layouts[boardId] ?? { groupFrames: {} },
          scenario: board.scenario,
        });
        const h = histories.get(boardId);
        if (h) boardStore.setState({ past: h.past, future: h.future });
      } finally {
        loading = false;
      }
      const project = projectOfBoard(data, boardId);
      if (project) lastBoardOfProject.set(project.id, boardId);
    }

    /** Run a pure op; on WorkspaceError record it and return `{ok:false}`. */
    function run<T extends object>(fn: () => T): WorkspaceResult<T> {
      try {
        const out = fn();
        if (get().lastError !== null) set({ lastError: null });
        return { ok: true, ...out };
      } catch (e) {
        if (!(e instanceof WorkspaceError)) throw e;
        set({ lastError: e.message });
        return { ok: false, reason: e.message };
      }
    }

    /** Commit new data and open `boardId` if given (or keep the active one if it still exists). */
    function commit(data: WorkspaceData, open?: string) {
      const active = get().activeBoardId;
      let target = open ?? active;
      if (data.boards[target] === undefined) {
        const oldProject = projectOfBoard(get().data, active);
        const sameProject = oldProject && data.projects.find((p) => p.id === oldProject.id);
        target = sameProject?.boardIds[0] ?? firstBoardId(data);
      }
      if (target !== active) {
        show(data, target, data.boards[active] !== undefined);
        set({ data, activeBoardId: target });
      } else {
        set({ data });
      }
    }

    const activeProjectId = () => projectOfBoard(get().data, get().activeBoardId)?.id ?? '';

    return {
      data: initialData,
      activeBoardId: firstBoardId(initialData),
      lastError: null,

      replace(data, activeBoardId) {
        const d = normalizeWorkspace(data, deps);
        histories.clear();
        lastBoardOfProject.clear();
        const target =
          activeBoardId !== undefined && d.boards[activeBoardId] !== undefined
            ? activeBoardId
            : firstBoardId(d);
        show(d, target, false);
        set({ data: d, activeBoardId: target, lastError: null });
      },

      openBoard(boardId) {
        return run(() => {
          const { data } = get();
          requireBoard(data, boardId);
          if (boardId !== get().activeBoardId) {
            show(data, boardId, true);
            set({ activeBoardId: boardId });
          }
          return {};
        });
      },

      openProject(projectId) {
        return run(() => {
          const project = requireProject(get().data, projectId);
          const remembered = lastBoardOfProject.get(projectId);
          const target =
            remembered !== undefined && project.boardIds.includes(remembered)
              ? remembered
              : project.boardIds[0];
          if (target === undefined) throw new WorkspaceError('Project has no boards');
          const res = get().openBoard(target);
          if (!res.ok) throw new WorkspaceError(res.reason);
          return {};
        });
      },

      createProject(name) {
        return run(() => {
          const out = createProject(get().data, deps, name);
          commit(out.data, out.boardId);
          return { projectId: out.projectId, boardId: out.boardId };
        });
      },

      renameProject(projectId, name) {
        return run(() => {
          commit(renameProject(get().data, deps, projectId, name));
          return {};
        });
      },

      duplicateProject(projectId) {
        return run(() => {
          const out = duplicateProject(get().data, deps, projectId);
          commit(out.data);
          return { projectId: out.projectId };
        });
      },

      deleteProject(projectId) {
        return run(() => {
          const ids = requireProject(get().data, projectId).boardIds;
          const data = deleteProject(get().data, projectId);
          commit(data);
          ids.forEach((id) => histories.delete(id));
          lastBoardOfProject.delete(projectId);
          return {};
        });
      },

      moveProject(projectId, toIndex) {
        return run(() => {
          commit(moveProject(get().data, projectId, toIndex));
          return {};
        });
      },

      createBoard(projectId, name) {
        return run(() => {
          const out = createBoard(get().data, deps, projectId ?? activeProjectId(), name);
          commit(out.data, out.boardId);
          return { boardId: out.boardId };
        });
      },

      renameBoard(boardId, name) {
        return run(() => {
          commit(renameBoard(get().data, deps, boardId, name));
          return {};
        });
      },

      duplicateBoard(boardId) {
        return run(() => {
          const out = duplicateBoard(get().data, deps, boardId);
          commit(out.data, out.boardId);
          return { boardId: out.boardId };
        });
      },

      deleteBoard(boardId) {
        return run(() => {
          const data = get().data;
          const project = projectOfBoard(data, boardId);
          const index = project?.boardIds.indexOf(boardId) ?? 0;
          const next = deleteBoard(data, deps, boardId);
          let open: string | undefined;
          if (boardId === get().activeBoardId && project) {
            // Open the tab that slid into its place (or the new last tab).
            const ids = next.projects.find((p) => p.id === project.id)?.boardIds ?? [];
            open = ids[Math.min(index, ids.length - 1)];
          }
          commit(next, open);
          histories.delete(boardId);
          return {};
        });
      },

      moveBoard(boardId, toIndex) {
        return run(() => {
          commit(moveBoard(get().data, deps, boardId, toIndex));
          return {};
        });
      },

      saveSnapshot(label, boardId) {
        return run(() => {
          const out = addSnapshot(get().data, deps, boardId ?? get().activeBoardId, label);
          commit(out.data);
          return { snapshotId: out.snapshotId };
        });
      },

      restoreSnapshot(snapshotId) {
        return run(() => {
          const board = requireBoard(get().data, get().activeBoardId);
          const snap = requireSnapshot(board, snapshotId);
          const res = boardStore.getState().dispatch({
            type: 'replaceGraph',
            graph: snap.graph,
            label: `Restore "${snap.label}"`,
          });
          if (!res.ok) throw new WorkspaceError(res.reason);
          return {};
        });
      },

      deleteSnapshot(snapshotId, boardId) {
        return run(() => {
          commit(deleteSnapshot(get().data, deps, boardId ?? get().activeBoardId, snapshotId));
          return {};
        });
      },

      importBoards(incoming, projectId) {
        return run(() => {
          if (incoming.boards.length === 0) throw new WorkspaceError('The file has no boards');
          const out = importBoards(get().data, deps, incoming, projectId ?? activeProjectId());
          commit(out.data, out.boardIds[0]);
          return { boardIds: out.boardIds };
        });
      },

      importProjects(incoming) {
        return run(() => {
          if (incoming.projects.length === 0) throw new WorkspaceError('The file has no projects');
          const out = importProjects(get().data, deps, incoming);
          commit(out.data, out.boardIds[0]);
          return { projectIds: out.projectIds, boardIds: out.boardIds };
        });
      },

      clearError() {
        if (get().lastError !== null) set({ lastError: null });
      },
    };
  });

  // Open the first board, then mirror every board-store edit back into the workspace.
  {
    const s = store.getState();
    loading = true;
    const board = requireBoard(s.data, s.activeBoardId);
    try {
      boardStore.getState().load({
        graph: board.graph,
        providerId: board.providerId,
        layout: s.data.layouts[board.id] ?? { groupFrames: {} },
        scenario: board.scenario,
      });
    } finally {
      loading = false;
    }
  }

  boardStore.subscribe((next, prev) => {
    if (loading || next.doc === prev.doc) return;
    const { data, activeBoardId } = store.getState();
    const board = data.boards[activeBoardId];
    if (!board) return;
    const doc = next.doc;
    const updated = putBoard(
      data,
      deps,
      { ...board, providerId: doc.providerId, graph: doc.graph, scenario: doc.scenario },
      doc.layout,
    );
    store.setState({ data: updated });
  });

  return store;
}
