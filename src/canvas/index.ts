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
// S24 — request trace width (pure helpers; the app persists the size)
export {
  clampTraceWidth,
  traceWidthCss,
  resizeTraceByKey,
  DEFAULT_TRACE_SIZE,
  TRACE_DEFAULT_WIDTH,
  TRACE_MIN_WIDTH,
  TRACE_MAX_WIDTH,
  TRACE_MAX_SHARE,
  type TraceSize,
} from './trace/trace-size';
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
// S16 — security overlay and threat review (the app fills the store and applies fixes)
export { SecurityPanel } from './security/SecurityPanel';
export { useSecurityStore, useSecurityStoreApi } from './security/context';
export {
  createSecurityStore,
  severityCounts,
  SEVERITY_ORDER,
  EXPOSURE_STYLE,
  ENCRYPTION_STROKE,
  type SecurityState,
  type SecurityStore,
  type SecurityView,
  type SecurityViewFinding,
  type SecuritySeverity,
  type SecurityExposure,
  type SecurityEncryption,
  type FixHandler,
} from './security/security-store';
// S19 — design review panel (the app runs the engine's review and applies fixes)
export { FindingsPanel } from './review/FindingsPanel';
export { useReviewStore, useReviewStoreApi } from './review/context';
export {
  createReviewStore,
  categoryCounts,
  jumpTarget,
  REVIEW_CATEGORIES,
  REVIEW_CATEGORY_LABEL,
  type ReviewState,
  type ReviewStore,
  type ReviewView,
  type ReviewViewFinding,
  type ReviewCategory,
  type ReviewFilter,
} from './review/review-store';
