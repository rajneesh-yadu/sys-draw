/**
 * S21 performance: level of detail. On a large board viewed zoomed out (the whole 300-node
 * fixture fits at ~0.25×), node icons, product names, metric pills and edge labels are a few
 * pixels tall: unreadable, yet they are most of what the browser paints on every pan frame.
 * Below `LOD_ZOOM` on boards with ≥ `LOD_MIN_NODES` nodes, nodes draw as their coloured border
 * (utilisation / exposure stays visible) plus the label, and edge labels are hidden; selected,
 * traced and security-highlighted elements keep full detail. Zooming in restores everything.
 */
import { useStore, type ReactFlowState } from '@xyflow/react';

export const LOD_ZOOM = 0.5;
export const LOD_MIN_NODES = 100;

export function isLowDetail(zoom: number, nodeCount: number): boolean {
  return zoom < LOD_ZOOM && nodeCount >= LOD_MIN_NODES;
}

const selectLowDetail = (s: ReactFlowState) => isLowDetail(s.transform[2], s.nodes.length);

/** True while the canvas should draw simplified nodes/edges (boolean selector: re-renders only on change). */
export function useLowDetail(): boolean {
  return useStore(selectLowDetail);
}
