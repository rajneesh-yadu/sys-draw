/** React access to the mode session store and the progress store, plus the runner hook. */
import { createContext, useContext, useEffect, useMemo } from 'react';
import { useStore } from 'zustand';
import { runSimulation } from '@/engine';
import { registry as appRegistry } from '@/registry';
import {
  useBoardStore,
  useBoardStoreApi,
  useSimulationStore,
  useSimulationStoreApi,
  useWorkspaceStore,
  useWorkspaceStoreApi,
} from '@/store';
import { createModeStore, type ModeStore, type ModeStoreState } from '../mode-store';
import {
  createProgressStore,
  memoryProgressStorage,
  type ProgressState,
  type ProgressStore,
} from '../progress';
import { modes } from '../registry';
import { startModeRunner } from '../runner';
import type { ModeContext } from '../types';

export interface ModesContextValue {
  modeStore: ModeStore;
  progressStore: ProgressStore;
}

/** Used outside ModesProvider (isolated tests): an idle session and in-memory progress. */
const INERT: ModesContextValue = {
  modeStore: createModeStore(),
  progressStore: createProgressStore(memoryProgressStorage()),
};

export const ModesContext = createContext<ModesContextValue | null>(null);

export function useModeStoreApi(): ModeStore {
  return (useContext(ModesContext) ?? INERT).modeStore;
}
export function useModeStore<T>(selector: (s: ModeStoreState) => T): T {
  return useStore(useModeStoreApi(), selector);
}
export function useProgressStoreApi(): ProgressStore {
  return (useContext(ModesContext) ?? INERT).progressStore;
}
export function useProgressStore<T>(selector: (s: ProgressState) => T): T {
  return useStore(useProgressStoreApi(), selector);
}

/**
 * Run the mode controllers for the open board while mounted (the app calls this once). The
 * engine worker simulates reference designs for Interview's cost score.
 */
export function useModeRunner(modeStore: ModeStore, progressStore: ProgressStore, enabled = true) {
  const workspaceStore = useWorkspaceStoreApi();
  const boardStore = useBoardStoreApi();
  const simulationStore = useSimulationStoreApi();
  useEffect(() => {
    if (!enabled) return;
    const runner = startModeRunner({
      workspaceStore,
      boardStore,
      simulationStore,
      modeStore,
      progressStore,
      registry: appRegistry,
      modes,
      run: (input) => runSimulation(input as Parameters<typeof runSimulation>[0]),
    });
    return () => runner.dispose();
  }, [enabled, workspaceStore, boardStore, simulationStore, modeStore, progressStore]);
}

/** The context the panels judge with (same inputs the runner gives the controllers). */
export function useModeContext(): ModeContext {
  const boardId = useWorkspaceStore((s) => s.activeBoardId);
  const problemId = useWorkspaceStore((s) => s.data.boards[s.activeBoardId]?.problemId);
  const graph = useBoardStore((s) => s.doc.graph);
  const scenario = useBoardStore((s) => s.doc.scenario);
  const result = useSimulationStore((s) => (s.boardId === boardId ? s.result : null));
  // The runner's clock at the last session change (Interview ticks update it every second).
  const nowMs = useModeStore((s) => s.session?.atMs ?? 0);
  return useMemo(
    () => ({
      boardId,
      graph,
      scenario,
      problem: problemId ? appRegistry.get(problemId, 'problem') : undefined,
      result,
      registry: appRegistry,
      nowMs,
    }),
    [boardId, graph, scenario, problemId, result, nowMs],
  );
}
