import { useEffect } from 'react';
import { runSimulation } from '@/engine';
import { useBoardStoreApi, useSimulationStoreApi, useWorkspaceStoreApi } from '@/store';
import { startSimulationRunner } from './runner';

/** Keep the open board simulated while the shell is mounted (engine runs in its Web Worker). */
export function useSimulationRunner(enabled = true): void {
  const boardStore = useBoardStoreApi();
  const workspaceStore = useWorkspaceStoreApi();
  const simulationStore = useSimulationStoreApi();
  useEffect(() => {
    if (!enabled) return;
    const runner = startSimulationRunner({
      boardStore,
      workspaceStore,
      simulationStore,
      run: (input) => runSimulation(input),
    });
    return () => runner.dispose();
  }, [enabled, boardStore, workspaceStore, simulationStore]);
}
