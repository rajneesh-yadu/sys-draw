import { useEffect } from 'react';
import type { TraceStore } from '@/canvas';
import { runTrace } from '@/engine';
import { useBoardStoreApi } from '@/store';
import { startTraceRunner } from './runner';

/** Keep the trace panel's request traced (engine worker) while the shell is mounted. */
export function useTraceRunner(traceStore: TraceStore): void {
  const boardStore = useBoardStoreApi();
  useEffect(() => {
    const runner = startTraceRunner({
      boardStore,
      traceStore,
      run: (input, flowId, regionId, options) => runTrace(input, flowId, regionId, options),
    });
    return () => runner.dispose();
  }, [boardStore, traceStore]);
}
