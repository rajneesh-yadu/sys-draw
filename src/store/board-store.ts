/**
 * The board store: Zustand (vanilla) + Immer patches. `dispatch` is the command bus; each
 * successful command pushes one history entry (patches + inverse patches) for undo/redo.
 */
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  newId as coreNewId,
  type Graph,
  type IdKind,
  type ProviderId,
  type Scenario,
} from '@/core';
import type { Registry } from '@/registry';
import { cloneSubgraph, extractSubgraph } from './clipboard';
import { applyCommand, commandLabel, CommandError, type BoardCommand } from './commands';
import {
  defaultScenario,
  emptyBoardDoc,
  type BoardDoc,
  type BoardLayout,
  type Subgraph,
} from './types';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

export type DispatchResult = { ok: true } | { ok: false; reason: string };

/** Offset applied to each successive paste so copies don't stack exactly. */
export const PASTE_OFFSET = 32;

export interface BoardState {
  doc: BoardDoc;
  /** Selected node, edge and group ids (not part of undo history). */
  selection: string[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  clipboard: Subgraph | null;
  /** Error from the last failed command, for a toast/status line. */
  lastError: string | null;

  dispatch(cmd: BoardCommand): DispatchResult;
  undo(): boolean;
  redo(): boolean;
  setSelection(ids: readonly string[]): void;
  /** Copy `ids` (default: selection). Returns the number of items copied. */
  copy(ids?: readonly string[]): number;
  cut(ids?: readonly string[]): DispatchResult;
  paste(): DispatchResult;
  deleteSelection(): DispatchResult;
  clearError(): void;
  /** Replace the board (e.g. when switching boards). Clears history and selection. */
  load(doc: {
    graph: Graph;
    providerId?: ProviderId;
    layout?: BoardLayout;
    scenario?: Scenario;
  }): void;
}

export type BoardStore = StoreApi<BoardState>;

export interface BoardStoreOptions {
  registry: Registry;
  newId?: (kind: IdKind) => string;
  historyLimit?: number;
  initial?: BoardDoc;
}

/** Keep only ids that still exist on the board. */
function liveIds(doc: BoardDoc, ids: readonly string[]): string[] {
  const all = new Set([
    ...doc.graph.nodes.map((n) => n.id),
    ...doc.graph.edges.map((e) => e.id),
    ...doc.graph.groups.map((g) => g.id),
  ]);
  return ids.filter((id) => all.has(id));
}

export function createBoardStore(opts: BoardStoreOptions): BoardStore {
  const ctx = { registry: opts.registry, newId: opts.newId ?? ((k: IdKind) => coreNewId(k)) };
  const limit = opts.historyLimit ?? 200;
  let pasteCount = 0;

  return createStore<BoardState>()((set, get) => ({
    doc: opts.initial ?? emptyBoardDoc(),
    selection: [],
    past: [],
    future: [],
    clipboard: null,
    lastError: null,

    dispatch(cmd) {
      let next: BoardDoc;
      let patches: Patch[];
      let inverse: Patch[];
      try {
        [next, patches, inverse] = produceWithPatches(get().doc, (d) => applyCommand(d, cmd, ctx));
      } catch (e) {
        if (!(e instanceof CommandError)) throw e;
        set({ lastError: e.message });
        return { ok: false, reason: e.message };
      }
      if (patches.length === 0) return { ok: true };
      const entry: HistoryEntry = { label: commandLabel(cmd), patches, inverse };
      set((s) => ({
        doc: next,
        past: [...s.past, entry].slice(-limit),
        future: [],
        selection: liveIds(next, s.selection),
        lastError: null,
      }));
      return { ok: true };
    },

    undo() {
      const { past, doc } = get();
      const entry = past[past.length - 1];
      if (!entry) return false;
      const prev = applyPatches(doc, entry.inverse);
      set((s) => ({
        doc: prev,
        past: s.past.slice(0, -1),
        future: [entry, ...s.future],
        selection: liveIds(prev, s.selection),
      }));
      return true;
    },

    redo() {
      const { future, doc } = get();
      const entry = future[0];
      if (!entry) return false;
      const next = applyPatches(doc, entry.patches);
      set((s) => ({
        doc: next,
        past: [...s.past, entry].slice(-limit),
        future: s.future.slice(1),
        selection: liveIds(next, s.selection),
      }));
      return true;
    },

    setSelection(ids) {
      const cur = get().selection;
      if (cur.length === ids.length && ids.every((id) => cur.includes(id))) return;
      set({ selection: [...ids] });
    },

    copy(ids) {
      const sub = extractSubgraph(get().doc, ids ?? get().selection);
      const count = sub.nodes.length + sub.groups.length;
      if (count === 0) return 0;
      pasteCount = 0;
      set({ clipboard: sub });
      return count;
    },

    cut(ids) {
      const target = [...(ids ?? get().selection)];
      if (get().copy(target) === 0) return { ok: false, reason: 'Nothing selected' };
      return get().dispatch({ type: 'delete', ids: target });
    },

    paste() {
      const clip = get().clipboard;
      if (!clip) return { ok: false, reason: 'Clipboard is empty' };
      pasteCount += 1;
      const off = PASTE_OFFSET * pasteCount;
      const sub = cloneSubgraph(clip, { x: off, y: off }, ctx.newId, get().doc.graph);
      const res = get().dispatch({ type: 'insert', subgraph: sub });
      if (res.ok) {
        set({
          selection: [...sub.nodes.map((n) => n.id), ...sub.groups.map((g) => g.id)],
        });
      }
      return res;
    },

    deleteSelection() {
      const ids = get().selection;
      if (ids.length === 0) return { ok: false, reason: 'Nothing selected' };
      return get().dispatch({ type: 'delete', ids: [...ids] });
    },

    clearError() {
      if (get().lastError !== null) set({ lastError: null });
    },

    load(doc) {
      pasteCount = 0;
      set({
        doc: {
          providerId: doc.providerId ?? 'generic',
          graph: doc.graph,
          layout: doc.layout ?? { groupFrames: {} },
          scenario: doc.scenario ?? defaultScenario(),
        },
        selection: [],
        past: [],
        future: [],
        lastError: null,
      });
    },
  }));
}
