import { ReactFlowProvider } from '@xyflow/react';
import { useMemo, useState, type ReactNode } from 'react';
import type { GroupKind } from '@/store';
import { CanvasUiContext } from './context';
import { ReviewStoreContext } from './review/context';
import { createReviewStore, type ReviewStore } from './review/review-store';
import { SecurityStoreContext } from './security/context';
import { createSecurityStore, type SecurityStore } from './security/security-store';
import { TraceStoreContext } from './trace/context';
import { createTraceStore, type TraceStore } from './trace/trace-store';

/**
 * Wrap the palette and the canvas (they share the React Flow instance and canvas settings).
 * S15: also holds the request-trace store (pass `traceStore` to share one with the app's runner).
 * S16: and the security overlay store (`securityStore`). S19: and the design review (`reviewStore`).
 */
export function CanvasProvider({
  children,
  traceStore,
  securityStore,
  reviewStore,
}: {
  children: ReactNode;
  traceStore?: TraceStore | undefined;
  /** S16: the security overlay/review store (pass one to share it with the app's runner). */
  securityStore?: SecurityStore | undefined;
  /** S19: the design review store (pass one to share it with the app's runner). */
  reviewStore?: ReviewStore | undefined;
}) {
  const [ownTrace] = useState(createTraceStore);
  const [ownSecurity] = useState(createSecurityStore);
  const [ownReview] = useState(createReviewStore);
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
          <ReviewStoreContext.Provider value={reviewStore ?? ownReview}>
            <CanvasUiContext.Provider value={ui}>{children}</CanvasUiContext.Provider>
          </ReviewStoreContext.Provider>
        </SecurityStoreContext.Provider>
      </TraceStoreContext.Provider>
    </ReactFlowProvider>
  );
}
