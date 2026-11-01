import { useEffect } from 'react';
import type { ReviewStore } from '@/canvas';
import { registry } from '@/registry';
import { useBoardStoreApi, useSimulationStoreApi, useWorkspaceStoreApi } from '@/store';
import { startReviewRunner } from './runner';

/** Keep the design review current while the shell is mounted (S19). */
export function useReviewRunner(reviewStore: ReviewStore): void {
  const boardStore = useBoardStoreApi();
  const simulationStore = useSimulationStoreApi();
  const workspaceStore = useWorkspaceStoreApi();
  useEffect(() => {
    const runner = startReviewRunner({
      boardStore,
      reviewStore,
      registry,
      simulationStore,
      workspaceStore,
    });
    return () => runner.dispose();
  }, [boardStore, reviewStore, simulationStore, workspaceStore]);
}
