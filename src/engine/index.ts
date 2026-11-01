/**
 * engine — public API.
 * Other modules may import ONLY from this file (enforced by eslint-plugin-boundaries).
 * See ./README.md.
 */
export { runSimulation, disposeSimulationWorker } from './client';
export { simulate, BOTTLENECK_UTILIZATION } from './simulate';
export { compile, type ComponentSource } from './model/compile';
export { generateLoad, inferFlow, totalUsers, INFERRED_FLOW_ID, type FlowLoad } from './model/load';
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
export { BEHAVIORS, defineBehavior, type Behavior } from './behaviors';
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
