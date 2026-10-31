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

export interface Behavior {
  /** Matches an id in ComponentDefinition.behaviors. */
  id: string;
  /** Inferred flows: how this node's downstream calls combine. `undefined` = default. */
  routeOut?(ctx: RouteOutContext): Expr | undefined;
  /** Explicit flow paths: transform the rest of the path after this step. `undefined` = keep. */
  routeRest?(ctx: RouteRestContext): Expr | undefined;
  /** If this node is a cache used cache-aside by its caller: its hit rate. */
  cacheAsideHitRate?(node: CompiledNode, options: EngineOptions): number | undefined;
  /** Adjust metrics/explain after queueing (e.g. hit rate, queue lag). */
  finish?(ctx: FinishContext): void;
}

export function defineBehavior(b: Behavior): Behavior {
  return Object.freeze(b);
}
