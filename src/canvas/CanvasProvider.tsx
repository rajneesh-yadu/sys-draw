import { ReactFlowProvider } from '@xyflow/react';
import { useMemo, useState, type ReactNode } from 'react';
import type { GroupKind } from '@/store';
import { CanvasUiContext } from './context';

/** Wrap the palette and the canvas (they share the React Flow instance and canvas settings). */
export function CanvasProvider({ children }: { children: ReactNode }) {
  const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null);
  const [snap, setSnap] = useState(true);
  const [groupKind, setGroupKind] = useState<GroupKind>('vpc');
  const ui = useMemo(
    () => ({ wrapper, setWrapper, snap, setSnap, groupKind, setGroupKind }),
    [wrapper, snap, groupKind],
  );
  return (
    <ReactFlowProvider>
      <CanvasUiContext.Provider value={ui}>{children}</CanvasUiContext.Provider>
    </ReactFlowProvider>
  );
}
