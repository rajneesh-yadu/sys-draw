/** React bindings: the app's board and workspace stores, contexts that can swap them, and hooks. */
import { createContext, useContext } from 'react';
import type { IdKind } from '@/core';
import { useStore } from 'zustand';
import { registry } from '@/registry';
import { createBoardStore, type BoardState, type BoardStore } from './board-store';
import { createWorkspaceStore, type WorkspaceState, type WorkspaceStore } from './workspace-store';

/**
 * A fresh board store + workspace store pair on the app registry (tests, previews). The workspace
 * store drives the board store, exactly like the app's `boardStore`/`workspaceStore`.
 */
export function createAppStores(
  opts: { newId?: (kind: IdKind) => string; now?: () => string } = {},
): { boardStore: BoardStore; workspaceStore: WorkspaceStore } {
  const board = createBoardStore({ registry, ...(opts.newId ? { newId: opts.newId } : {}) });
  const ws = createWorkspaceStore({
    boardStore: board,
    ...(opts.newId ? { newId: opts.newId } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  return { boardStore: board, workspaceStore: ws };
}

/** The app-wide board store, built on the app registry. */
export const boardStore: BoardStore = createBoardStore({ registry });

/** The app-wide workspace store; it drives `boardStore` (opening a board loads it there). */
export const workspaceStore: WorkspaceStore = createWorkspaceStore({ boardStore });

export const BoardStoreContext = createContext<BoardStore>(boardStore);
export const WorkspaceStoreContext = createContext<WorkspaceStore>(workspaceStore);

/** The store in context (the app store unless a BoardStoreProvider overrides it). */
export function useBoardStoreApi(): BoardStore {
  return useContext(BoardStoreContext);
}

/** Subscribe to a slice of board state. Keep selectors cheap and return stable references. */
export function useBoardStore<T>(selector: (s: BoardState) => T): T {
  return useStore(useBoardStoreApi(), selector);
}

/** The workspace store in context (the app store unless a WorkspaceStoreProvider overrides it). */
export function useWorkspaceStoreApi(): WorkspaceStore {
  return useContext(WorkspaceStoreContext);
}

/** Subscribe to a slice of workspace state. Return stable references from the selector. */
export function useWorkspaceStore<T>(selector: (s: WorkspaceState) => T): T {
  return useStore(useWorkspaceStoreApi(), selector);
}
