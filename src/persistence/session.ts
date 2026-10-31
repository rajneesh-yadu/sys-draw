/**
 * Loading the workspace on start (migrate + validate + repair), debounced autosave, and
 * import of files into the open workspace.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { BoardLayout, WorkspaceData, WorkspaceStore } from '@/store';
import type { StorageAdapter, StoredBoard, StoredWorkspace } from './adapter';
import { parseSaveFile, toWorkspaceData, type SaveKind } from './save-file';
import { CURRENT_SCHEMA_VERSION } from '@/core';

// ---------- stored ↔ data ----------

function workspaceRow(data: WorkspaceData): Record<string, unknown> {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    settings: data.settings,
    projects: data.projects,
  };
}

function boardRow(data: WorkspaceData, id: string): StoredBoard {
  return { id, board: data.boards[id], layout: data.layouts[id] };
}

function toStored(
  data: WorkspaceData,
  activeBoardId: string,
): StoredWorkspace & { ui: { activeBoardId: string } } {
  return {
    workspace: workspaceRow(data),
    boards: Object.keys(data.boards).map((id) => boardRow(data, id)),
    ui: { activeBoardId },
  };
}

/** Rebuild a save-file-shaped object from storage rows, for `parseSaveFile`. */
function storedToRaw(stored: StoredWorkspace): Record<string, unknown> {
  const layouts: Record<string, unknown> = {};
  for (const b of stored.boards) if (b.layout !== undefined) layouts[b.id] = b.layout;
  return {
    ...stored.workspace,
    format: 'sysdraw',
    kind: 'workspace',
    boards: stored.boards.map((b) => b.board),
    layouts,
  };
}

// ---------- autosave ----------

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export interface AutosaveStatus {
  state: SaveState;
  lastSavedAt: string | null;
  error: string | null;
}

export interface Autosave {
  /** Observable save status for the UI. */
  status: StoreApi<AutosaveStatus>;
  /** Save now (also when autosave is off in settings). Resolves when written. */
  flush(): Promise<void>;
  /** Stop listening (pending changes are flushed first). */
  stop(): Promise<void>;
}

export interface AutosaveOptions {
  delayMs?: number;
}

export const DEFAULT_AUTOSAVE_DELAY_MS = 600;

/**
 * Save the workspace a short while after each change. Only boards whose object changed since the
 * last save are written (immutable updates make that a reference check); deleted boards are
 * removed. Honours `settings.autosave` (off = only `flush()` saves).
 */
export function startAutosave(
  store: WorkspaceStore,
  adapter: StorageAdapter,
  options: AutosaveOptions = {},
): Autosave {
  const delay = options.delayMs ?? DEFAULT_AUTOSAVE_DELAY_MS;
  const status = createStore<AutosaveStatus>()(() => ({
    state: 'saved',
    lastSavedAt: null,
    error: null,
  }));
  // What storage holds, by reference.
  const saved = new Map<string, { board: unknown; layout: BoardLayout | undefined }>();
  {
    const { data } = store.getState();
    for (const id of Object.keys(data.boards)) {
      saved.set(id, { board: data.boards[id], layout: data.layouts[id] });
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<void> = Promise.resolve();
  let stopped = false;

  async function save(): Promise<void> {
    const { data, activeBoardId } = store.getState();
    const put: StoredBoard[] = [];
    for (const id of Object.keys(data.boards)) {
      const s = saved.get(id);
      if (!s || s.board !== data.boards[id] || s.layout !== data.layouts[id]) {
        put.push(boardRow(data, id));
      }
    }
    const remove = [...saved.keys()].filter((id) => data.boards[id] === undefined);
    status.setState({ state: 'saving' });
    try {
      await adapter.write({ workspace: workspaceRow(data), put, remove, ui: { activeBoardId } });
      for (const b of put) saved.set(b.id, { board: b.board, layout: data.layouts[b.id] });
      for (const id of remove) saved.delete(id);
      const changedSince = store.getState().data !== data;
      status.setState({
        state: changedSince ? 'pending' : 'saved',
        lastSavedAt: new Date().toISOString(),
        error: null,
      });
    } catch (e) {
      status.setState({ state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    chain = chain.then(save);
    return chain;
  }

  const unsubscribe = store.subscribe((next, prev) => {
    if (stopped) return;
    if (next.data === prev.data && next.activeBoardId === prev.activeBoardId) return;
    status.setState({ state: 'pending' });
    if (!next.data.settings.autosave) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void flush();
    }, delay);
  });

  return {
    status,
    flush,
    async stop() {
      const pending = status.getState().state === 'pending' || timer !== undefined;
      stopped = true;
      unsubscribe();
      if (pending) await flush();
      else await chain;
    },
  };
}

// ---------- open on start ----------

export interface OpenResult {
  /** `new` = first run; `loaded` = as stored; `upgraded` = migrated or repaired, then rewritten;
   * `reset` = stored data unreadable, backed up and started fresh. */
  status: 'new' | 'loaded' | 'upgraded' | 'reset';
  applied: string[];
  warnings: string[];
  autosave: Autosave;
}

/**
 * Load the workspace from storage into `store` (running migrations), then start autosave.
 * Anything that had to be migrated, repaired or skipped is backed up first, so nothing is lost.
 */
export async function openWorkspace(
  store: WorkspaceStore,
  adapter: StorageAdapter,
  options: AutosaveOptions = {},
): Promise<OpenResult> {
  let status: OpenResult['status'];
  let applied: string[] = [];
  let warnings: string[] = [];
  let stored: StoredWorkspace | null;
  try {
    stored = await adapter.read();
  } catch (e) {
    stored = null;
    warnings = [`Could not read saved data: ${e instanceof Error ? e.message : String(e)}`];
  }

  if (stored === null) {
    status = 'new';
    const s = store.getState();
    if (warnings.length === 0) await adapter.replaceAll(toStored(s.data, s.activeBoardId));
  } else {
    const parsed = parseSaveFile(storedToRaw(stored), { lenient: true });
    if (!parsed.ok) {
      status = 'reset';
      warnings = parsed.errors;
      await adapter.backup(stored, `Unreadable workspace: ${parsed.errors.join('; ')}`);
      const s = store.getState();
      await adapter.replaceAll(toStored(s.data, s.activeBoardId));
    } else {
      ({ applied, warnings } = parsed.value);
      store.getState().replace(toWorkspaceData(parsed.value.file), stored.ui?.activeBoardId);
      const s = store.getState();
      if (applied.length > 0 || warnings.length > 0) {
        status = 'upgraded';
        await adapter.backup(stored, [...applied, ...warnings].join('; '));
        await adapter.replaceAll(toStored(s.data, s.activeBoardId));
      } else {
        status = 'loaded';
      }
    }
  }
  return { status, applied, warnings, autosave: startAutosave(store, adapter, options) };
}

// ---------- import ----------

export type ImportResult =
  | {
      ok: true;
      kind: SaveKind;
      projectIds: string[];
      boardIds: string[];
      applied: string[];
      warnings: string[];
    }
  | { ok: false; errors: string[] };

/**
 * Import a file (text or parsed JSON). Board files go into `projectId` (default: the open
 * project); project and workspace files add their projects. Validates and migrates first;
 * nothing changes if the file is invalid.
 */
export function importSaveFile(
  store: WorkspaceStore,
  input: unknown,
  options: { projectId?: string } = {},
): ImportResult {
  const parsed = parseSaveFile(input);
  if (!parsed.ok) return parsed;
  const { file, applied, warnings } = parsed.value;
  if (file.kind === 'board') {
    const res = store
      .getState()
      .importBoards({ boards: file.boards, layouts: file.layouts }, options.projectId);
    if (!res.ok) return { ok: false, errors: [res.reason] };
    return { ok: true, kind: file.kind, projectIds: [], boardIds: res.boardIds, applied, warnings };
  }
  const res = store.getState().importProjects({
    projects: file.projects,
    boards: file.boards,
    layouts: file.layouts,
  });
  if (!res.ok) return { ok: false, errors: [res.reason] };
  return {
    ok: true,
    kind: file.kind,
    projectIds: res.projectIds,
    boardIds: res.boardIds,
    applied,
    warnings,
  };
}
