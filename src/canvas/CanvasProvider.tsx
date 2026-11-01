import { ReactFlowProvider } from '@xyflow/react';
import { useMemo, useState, type ReactNode } from 'react';
import type { GroupKind } from '@/store';
import { CanvasUiContext } from './context';
import { TraceStoreContext } from './trace/context';
import { createTraceStore, type TraceStore } from './trace/trace-store';

/**
 * Wrap the palette and the canvas (they share the React Flow instance and canvas settings).
 * S15: also holds the request-trace store (pass `traceStore` to share one with the app's runner).
 */
export function CanvasProvider({
  children,
  traceStore,
}: {
  children: ReactNode;
  traceStore?: TraceStore | undefined;
}) {
  const [ownTrace] = useState(createTraceStore);
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const [snap, setSnap] = useState(true);
  const [groupKind, setGroupKind] = useState<GroupKind>('vpc');
  const ui = useMemo(
    () => ({ wrapper, setWrapper, snap, setSnap, groupKind, setGroupKind }),
    [wrapper, snap, groupKind],
  );
  return (
    <ReactFlowProvider>
      <TraceStoreContext.Provider value={traceStore ?? ownTrace}>
        <CanvasUiContext.Provider value={ui}>{children}</CanvasUiContext.Provider>
      </TraceStoreContext.Provider>
    </ReactFlowProvider>
  );
}
