/**
 * metrics-ui — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md. Implemented in S08.
 */
export { MetricsDrawer } from './MetricsDrawer';
// S21 — resizable / maximisable drawer
export {
  clampDrawerHeight,
  drawerBodyHeight,
  resizeByKey,
  DRAWER_DEFAULT_HEIGHT,
  DRAWER_MAX_HEIGHT,
  DRAWER_MIN_HEIGHT,
  type DrawerSize,
} from './drawer-size';
export { NodeDetail, LatencyChart, UtilizationMeter } from './NodeDetail';
export { FormulaValue } from './FormulaValue';
// S11 — failures over time
export { FailuresPanel } from './FailuresPanel';
export {
  CHAOS_KIND_META,
  boardRegions,
  buildChaosEvent,
  chaosEventLabel,
  chaosWhen,
  emptyDraft,
  eventSpans,
  PLAYBACK_MS_PER_TICK,
  type ChaosDraft,
  type ChaosKindMeta,
  type ChaosParam,
  type ChaosTarget,
} from './chaos';
export {
  bottleneckRows,
  flowFormula,
  flowName,
  nodeFormula,
  regionFormula,
  regionRows,
  systemFormulas,
  INFERRED_FLOW_ID,
  INFERRED_FLOW_NAME,
  type FlowField,
  type NodeField,
  type RegionField,
  type RegionMetrics,
  type SystemFormulas,
} from './formulas';
