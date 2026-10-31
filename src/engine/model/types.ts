/** Internal model types shared by every engine stage. Not part of the saved format. */
import type {
  ComponentDefinition,
  Finding,
  FlowStep,
  Graph,
  InstanceType,
  PerfModel,
  ProviderId,
  Scenario,
} from '@/core';

export type Op = FlowStep['op'];

/** What the engine needs from a board (a `Board` or the store's `BoardDoc` both fit). */
export interface SimInput {
  graph: Graph;
  scenario: Scenario;
  providerId?: ProviderId | undefined;
}

export interface EngineOptions {
  /** Requests per second per concurrent user for the inferred flow (scenario without flows). */
  defaultRpsPerUser: number;
  /** Cache hit rate when a cache node does not set `config.hitRate` (fixed for now; Zipf later). */
  defaultCacheHitRate: number;
  /** A saturated node is evaluated at this utilisation (M/M/c is undefined at ρ ≥ 1). */
  rhoCap: number;
  /** Latency mixtures keep at most this many branches (closest branches are merged). */
  maxBranches: number;
  /** Safety budget for graph walks when inferring a flow (very deep fan-in/fan-out graphs). */
  maxVisits: number;
}

export const DEFAULT_ENGINE_OPTIONS: Readonly<EngineOptions> = Object.freeze({
  defaultRpsPerUser: 0.1,
  defaultCacheHitRate: 0.8,
  rhoCap: 0.99,
  maxBranches: 32,
  maxVisits: 20_000,
});

/** `source` = clients (they generate traffic, no queue); `unknown` = defId not in the registry. */
export type NodeKind = 'source' | 'service' | 'unknown';

export interface CompiledNode {
  id: string;
  label: string;
  defId: string;
  kind: NodeKind;
  def?: ComponentDefinition | undefined;
  category?: string | undefined;
  behaviors: readonly string[];
  config: Readonly<Record<string, unknown>>;
  /** Horizontal scale: identical instances, each with its own queue. */
  replicas: number;
  instanceType?: InstanceType | undefined;
  /** Parallel servers inside one instance (M/M/c's c) = perf.maxConcurrencyPerInstance. */
  serversPerInstance: number;
  serviceTimeMs: { read: number; write: number };
  saturationBehavior: PerfModel['saturationBehavior'];
  /** Cloud region from the nearest enclosing group with a `regionId`. */
  regionId?: string | undefined;
  groupId?: string | undefined;
  /** Position in graph.nodes, for deterministic ordering. */
  index: number;
}

export interface CompiledEdge {
  id: string;
  source: string;
  target: string;
  sync: boolean;
  protocolStack: readonly string[];
  index: number;
}

export interface Model {
  nodes: ReadonlyMap<string, CompiledNode>;
  edges: ReadonlyMap<string, CompiledEdge>;
  /** Outgoing / incoming edges per node, in graph order. */
  out: ReadonlyMap<string, readonly CompiledEdge[]>;
  inbound: ReadonlyMap<string, readonly CompiledEdge[]>;
  /** Problems found while compiling (unknown components, unknown instance types). */
  issues: Finding[];
}

/** Per-node queueing result (mutable while behaviors finish it). */
export interface NodeStats {
  node: CompiledNode;
  rps: { read: number; write: number };
  /** Total arrival rate λ (rps) over all replicas. */
  lambda: number;
  /** Requests completed per second = λ × (1 − errorRate). */
  servedRps: number;
  /** Arrival rate per instance = λ / replicas. */
  lambdaPerInstance: number;
  /** Mean service time S̄ over the read/write mix (ms). */
  meanServiceMs: number;
  /** Service rate of one server, μ = 1000 / S̄ (rps). */
  muPerServer: number;
  /** Max throughput of the whole node = replicas × c × μ (rps). */
  capacityRps: number;
  utilization: number;
  /** Erlang C: probability an arrival has to wait. */
  waitProbability: number;
  wqMs: number;
  queueDepth: number;
  errorRate: number;
  responseMs: { read: number; write: number; mean: number };
  hitRate?: number | undefined;
  saturated: boolean;
  explain: Record<string, string>;
}
