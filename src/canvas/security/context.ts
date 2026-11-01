/** React access to the canvas's security store (created by CanvasProvider, filled by the app). */
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createSecurityStore, type SecurityState, type SecurityStore } from './security-store';

export const SecurityStoreContext = createContext<SecurityStore | null>(null);

/** Used when a component renders outside CanvasProvider (isolated tests): never opens. */
const INERT = createSecurityStore();

export function useSecurityStoreApi(): SecurityStore {
  return useContext(SecurityStoreContext) ?? INERT;
}

export function useSecurityStore<T>(selector: (s: SecurityState) => T): T {
  return useStore(useSecurityStoreApi(), selector);
}
