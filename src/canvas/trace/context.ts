/** React access to the canvas's trace store (created by CanvasProvider, filled by the app). */
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { createTraceStore, type TraceState, type TraceStore } from './trace-store';

export const TraceStoreContext = createContext<TraceStore | null>(null);

/** Used when a component renders outside CanvasProvider (isolated tests): never opens. */
const INERT = createTraceStore();

export function useTraceStoreApi(): TraceStore {
  return useContext(TraceStoreContext) ?? INERT;
}

export function useTraceStore<T>(selector: (s: TraceState) => T): T {
  return useStore(useTraceStoreApi(), selector);
}
