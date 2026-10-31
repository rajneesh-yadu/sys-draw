/** Shared canvas UI state (wrapper element, snap, group kind) for palette, toolbar and canvas. */
import { createContext, useContext } from 'react';
import type { GroupKind } from '@/store';

export interface CanvasUi {
  /** The canvas wrapper element (for the visible-centre calculation). */
  wrapper: HTMLDivElement | null;
  setWrapper: (el: HTMLDivElement | null) => void;
  snap: boolean;
  setSnap: (v: boolean) => void;
  groupKind: GroupKind;
  setGroupKind: (k: GroupKind) => void;
}

export const CanvasUiContext = createContext<CanvasUi | null>(null);

export function useCanvasUi(): CanvasUi {
  const ui = useContext(CanvasUiContext);
  if (!ui) throw new Error('Canvas components must be rendered inside <CanvasProvider>');
  return ui;
}
