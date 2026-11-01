/** Contract for behavior modules (one file per behavior in this folder, auto-discovered). */
import type { FlowStep } from '@/core';
import type { Expr } from '../model/expr';
import type {
  CompiledEdge,
  CompiledNode,
  EngineOptions,
  Model,
  NodeStats,
  Op,
} from '../model/types';

/** One downstream call from a node: the edge, its target, and the target's routed subtree. */
export interface Call {
  edge: CompiledEdge;
  target: CompiledNode;
  expr: Expr;
}

export interface RouteOutContext {
  node: CompiledNode;
  op: Op;
  calls: readonly Call[];
  model: Model;
  options: EngineOptions;
  /** The default way to combine calls (sequential, async edges off-path, cache-aside guard). */
  combine(calls: readonly Call[]): Expr;
}

export interface RouteRestContext {
  node: CompiledNode;
  op: Op;
  step: FlowStep;
  /** The remaining steps of an explicit flow path after this node. */
  rest: Expr;
  options: EngineOptions;
}

export interface FinishContext {
  node: CompiledNode;
  stats: NodeStats;
  model: Model;
  options: EngineOptions;
  durationSec: number;
  statsOf(nodeId: string): NodeStats | undefined;
}

/** What `tune` may change on a compiled node (applied in behavior order at compile time). */
export type NodeTuning = Partial<
  Pick<CompiledNode, 'serviceTimeMs' | 'responseServiceMs' | 'scale' | 'serversPerInstance'>
>;

/** DNS answer policy when several regions can serve a user (S10 geo). */
export type GeoPolicy = 'latency' | 'geo' | 'failover' | 'weighted' | 'simple';

export interface Behavior {
  /** Matches an id in ComponentDefinition.behaviors. */
  id: string;
  /**
   * Geo (S10): `edge` = the node runs at edge locations next to every user region (CDN, anycast
   * DNS) instead of in its group's region.
   */
  placement?: 'edge' | undefined;
  /**
   * Geo (S10): when this node's targets sit in several cloud regions it sends each request to ONE
   * region (nearest healthy by default) instead of calling them all. Clients always do (geo-DNS).
   */
  geoRoutes?: boolean | undefined;
  /** Geo (S10): a DNS node's answer policy, used by the clients that query it. */
  dnsPolicy?(node: CompiledNode): GeoPolicy | undefined;
  /** Inferred flows: how this node's downstream calls combine. `undefined` = default. */
  routeOut?(ctx: RouteOutContext): Expr | undefined;
  /** Explicit flow paths: transform the rest of the path after this step. `undefined` = keep. */
  routeRest?(ctx: RouteRestContext): Expr | undefined;
  /** If this node is a cache used cache-aside by its caller: its hit rate. */
  cacheAsideHitRate?(node: CompiledNode, options: EngineOptions): number | undefined;
  /**
   * Load balancers using consistent hashing: ring points per target instance. Targets of this
   * node then load their hottest replica f = 1 + √(2 ln N / V) × the average (scaling/pools.ts).
   */
  hashVirtualNodes?(node: CompiledNode): number | undefined;
  /**
   * S13: compile-time tuning from the node's config (consistency level, indexes, acks, pod
   * packing…). Receives the node as tuned so far by earlier behaviors; returns fields to replace.
   * `serviceTimeMs` is the WORK a request puts on the node (capacity, ρ); `responseServiceMs` the
   * time the caller waits for it besides queueing (e.g. the R-th fastest of N replicas).
   */
  tune?(node: CompiledNode): NodeTuning | undefined;
  /** Adjust metrics/explain after queueing (e.g. hit rate, queue lag). */
  finish?(ctx: FinishContext): void;
}

export function defineBehavior(b: Behavior): Behavior {
  return Object.freeze(b);
}
