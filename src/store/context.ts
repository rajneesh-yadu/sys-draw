/** React bindings: the app's board store, the context that can swap it, and the hooks. */
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { registry } from '@/registry';
import { createBoardStore, type BoardState, type BoardStore } from './board-store';

/** The app-wide board store, built on the app registry. */
export const boardStore: BoardStore = createBoardStore({ registry });

export const BoardStoreContext = createContext<BoardStore>(boardStore);

/** The store in context (the app store unless a BoardStoreProvider overrides it). */
export function useBoardStoreApi(): BoardStore {
  return useContext(BoardStoreContext);
}

/** Subscribe to a slice of board state. Keep selectors cheap and return stable references. */
export function useBoardStore<T>(selector: (s: BoardState) => T): T {
  return useStore(useBoardStoreApi(), selector);
}
