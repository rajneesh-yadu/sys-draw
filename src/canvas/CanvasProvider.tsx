import { ReactFlowProvider } from '@xyflow/react';
import { useMemo, useState, type ReactNode } from 'react';
import type { GroupKind } from '@/store';
import { CanvasUiContext } from './context';
import { SecurityStoreContext } from './security/context';
import { createSecurityStore, type SecurityStore } from './security/security-store';
import { TraceStoreContext } from './trace/context';
import { createTraceStore, type TraceStore } from './trace/trace-store';

/**
 * Wrap the palette and the canvas (they share the React Flow instance and canvas settings).
 * S15: also holds the request-trace store (pass `traceStore` to share one with the app's runner).
 * S16: and the security overlay store (`securityStore`).
 */
export function CanvasProvider({
  children,
  traceStore,
  securityStore,
}: {
  children: ReactNode;
  traceStore?: TraceStore | undefined;
  /** S16: the security overlay/review store (pass one to share it with the app's runner). */
  securityStore?: SecurityStore | undefined;
}) {
  const [ownTrace] = useState(createTraceStore);
  const [ownSecurity] = useState(createSecurityStore);
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
        <SecurityStoreContext.Provider value={securityStore ?? ownSecurity}>
          <CanvasUiContext.Provider value={ui}>{children}</CanvasUiContext.Provider>
        </SecurityStoreContext.Provider>
      </TraceStoreContext.Provider>
    </ReactFlowProvider>
  );
}
