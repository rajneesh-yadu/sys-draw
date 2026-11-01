/**
 * engine — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md.
 */
export { runSimulation, disposeSimulationWorker } from './client';
export { simulate, BOTTLENECK_UTILIZATION, INTER_REGION_PRICE_FACTOR } from './simulate';
export { compile, type ComponentSource } from './model/compile';
export {
  generateLoad,
  inferFlow,
  totalUsers,
  INFERRED_FLOW_ID,
  type FlowLoad,
  type RegionLoad,
} from './model/load';
export { route, combineCalls, type RoutePlan, type RoutedFlow } from './model/route';
export type { Expr } from './model/expr';
export {
  stageDist,
  fixedDist,
  sumDist,
  mixDist,
  distMean,
  quantile,
  percentiles,
  type Dist,
  type Branch,
} from './model/latency';
export { erlangB, erlangC, mmc, expQuantileFactor, type MmcResult } from './queueing/mmc';
export { nodeQueueing } from './queueing/node';
export { BEHAVIORS, defineBehavior, type Behavior, type GeoPolicy } from './behaviors';
export {
  DEFAULT_ENGINE_OPTIONS,
  type EngineOptions,
  type SimInput,
  type Model,
  type CompiledNode,
  type CompiledEdge,
  type NodeStats,
  type Op,
} from './model/types';
// S09 — scaling and cost
export {
  verticalSpeedup,
  verticalScale,
  AMDAHL_PARALLEL_FRACTION,
  type VerticalScale,
} from './scaling/vertical';
export {
  buildPools,
  capacityForMix,
  poolUtilization,
  consistentHashImbalance,
  servingInstances,
  readersPerShard,
  type Pool,
  type ScaleSpec,
} from './scaling/pools';
export { scaleSpecOf } from './scaling/spec';
export { SCALING_ROLES, scalingFields, roleValue, type ScalingRole } from './scaling/roles';
export {
  desiredReplicas,
  steadyStateReplicas,
  autoscaleTimeline,
  type AutoscaleTick,
  type AutoscaleTimelineOptions,
} from './scaling/autoscale';
export {
  nodeCost,
  FALLBACK_PRICING,
  HOURS_PER_MONTH,
  SECONDS_PER_MONTH,
  type NodeCost,
  type Pricing,
} from './cost/cost';
export {
  LB_ALGORITHMS,
  DEFAULT_VIRTUAL_NODES,
  lbAlgorithm,
  targetWeight,
  type LbAlgorithm,
} from './behaviors/loadBalancer';
// S10 — geography and real-world latency
export {
  haversineKm,
  propagationRttMs,
  netBetween,
  measuredKey,
  FIBRE_KM_PER_MS,
  ROUTE_FACTOR,
  PER_HOP_OVERHEAD_MS,
  EARTH_RADIUS_KM,
  MEASURED_RTT_MS,
  type Place,
  type NetHop,
  type MeasuredRtt,
} from './geo/distance';
export {
  DIURNAL_CURVE,
  DIURNAL_MEAN,
  DIURNAL_STEP_HOURS,
  diurnalFactor,
  diurnalPeak,
  type DiurnalPeak,
  type DiurnalRegion,
} from './geo/diurnal';
export {
  buildGeoModel,
  findCloudRegion,
  cloudPlace,
  userPlace,
  edgePlace,
  type GeoModel,
} from './geo/places';
export { placeOf, selectCalls, type GeoWalk, type CallOption } from './geo/routing';
// S11 — failures over time
export {
  evaluate,
  expectedAttempts,
  retrySuccess,
  timeoutProbability,
  RETRY_BACKOFF_BASE_MS,
  type Perturbation,
  type Evaluation,
  type EdgeAttempts,
} from './model/evaluate';
export { runTimeline, type TimelineInput, type TimelineResult } from './chaos/timeline';
export {
  eventWindow,
  isActive,
  eventLabel,
  packetLossDelayMs,
  packetLossExplain,
  nodesInGroup,
  healthCheckDelaySec,
  dnsTtlSec,
  DEFAULT_COLD_START_WINDOW_SEC,
  DEFAULT_COLD_START_MS,
  DEFAULT_HEALTH_CHECK_INTERVAL_SEC,
  DEFAULT_UNHEALTHY_THRESHOLD,
  DEFAULT_DNS_TTL_SEC,
  TCP_MIN_RTO_MS,
  TCP_MSS_BYTES,
  BREAKER_WINDOW_SEC,
  DEFAULT_BREAKER_OPEN_SEC,
  SCALE_IN_COOLDOWN_SEC,
} from './chaos/events';
