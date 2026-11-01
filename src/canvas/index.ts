/**
 * canvas — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md.
 */
export { CanvasProvider } from './CanvasProvider';
export { BoardCanvas } from './BoardCanvas';
export { Palette } from './Palette';
export { NODE_WIDTH, NODE_HEIGHT, GRID, computeGroupRects, findDropGroup } from './geometry';
export { computeAutoLayout } from './layout';
export { shortcutFor, SHORTCUT_HELP, type ShortcutAction } from './shortcuts';
// S15 — request trace (the app's runner fills the store; the canvas animates and lists it)
export { TracePanel } from './trace/TracePanel';
export { useTraceStore, useTraceStoreApi } from './trace/context';
export {
  createTraceStore,
  currentTraceStep,
  DEFAULT_TRACE_REQUEST,
  type TraceState,
  type TraceStore,
  type TraceStatus,
  type TraceView,
  type TraceViewStep,
  type TraceViewSegment,
  type TraceRequestSpec,
  type TraceWarmth,
} from './trace/trace-store';
export { traceColor, TRACE_COLOR_ORDER } from './trace/colors';
export {
  sequenceLayout,
  breakdownShares,
  elapsedAt,
  tracedEdgeIds,
  PACKET_ANIMATION_MS,
  STEP_INTERVAL_MS,
} from './trace/sequence';
