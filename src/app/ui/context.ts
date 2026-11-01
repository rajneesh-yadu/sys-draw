/** React bindings for the S21 UI store (created by AppShell, or passed in by tests). */
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { UiState, UiStore } from './ui-store';

export const UiStoreContext = createContext<UiStore | null>(null);

export function useUiStoreApi(): UiStore {
  const store = useContext(UiStoreContext);
  if (!store) throw new Error('useUiStoreApi must be used inside <UiStoreContext.Provider>');
  return store;
}

export function useUiStore<T>(selector: (s: UiState) => T): T {
  return useStore(useUiStoreApi(), selector);
}
