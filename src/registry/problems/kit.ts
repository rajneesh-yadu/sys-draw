/**
 * Authoring kit for problem entries (S17). Not an entry itself: discovery only loads
 * `problems/<id>/index.ts`. Keeps the ten problem files short and their graphs consistent:
 * - `design()` builds a reference `Graph` (ids `node_<key>`, `edge_<from>-<to>`, `grp_<key>`),
 *   laid out on a grid (col × 240 px, row × 140 px);
 * - `STACK` holds the protocol stacks the references use (bottom-up, IP implicit);
 * - `scenario()` builds a preset with explicit flow paths (keys → node ids).
 */
import type {
  EdgeConfig,
  EdgeInstance,
  Flow,
  Graph,
  Group,
  GroupKind,
  NodeInstance,
  Scenario,
  SecurityZone,
} from '@/core';

export const STACK = {
  /** Browser / app → edge over the internet. */
  https: ['tcp', 'tls13', 'http2'],
  /** Browser → CDN over QUIC. */
  http3: ['udp', 'quic', 'http3'],
  /** Long-lived push connection (chat, notifications, live location). */
  wss: ['tcp', 'tls13', 'websocket'],
  /** Inside the VPC to a non-service (queue, store, storage) over TLS. */
  internal: ['tcp', 'tls13', 'http2'],
  /** Service → service with mutual TLS (each side proves its identity). */
  svc: ['tcp', 'mtls', 'http2'],
  /** Service → HTTP-only store (ClickHouse). */
  http1: ['tcp', 'tls13', 'http1'],
  grpc: ['tcp', 'tls13', 'http2', 'grpc'],
  postgres: ['tcp', 'tls13', 'postgres-wire'],
  redis: ['tcp', 'tls13', 'resp'],
  cql: ['tcp', 'tls13', 'cql'],
  kafka: ['tcp', 'tls13', 'kafka-wire'],
  /** Publisher → RabbitMQ (AMQPS). */
  amqp: ['tcp', 'tls13', 'amqp'],
} as const satisfies Record<string, readonly string[]>;

export type Stack = readonly string[];

export interface NodeOptions {
  type: string;
  replicas?: number;
  group?: string;
  config?: Record<string, unknown>;
  /** S22: target-tracking autoscaling (`replicas` stays the starting size). */
  autoscale?: NonNullable<NodeInstance['scaling']['autoscale']>;
}

export interface EdgeOptions {
  async?: boolean;
  config?: EdgeConfig;
}

export interface Design {
  group(
    key: string,
    kind: GroupKind,
    label: string,
    opts?: { regionId?: string; parent?: string; zone?: SecurityZone },
  ): Design;
  node(
    key: string,
    defId: string,
    label: string,
    at: readonly [col: number, row: number],
    opts: NodeOptions,
  ): Design;
  edge(from: string, to: string, stack: Stack, opts?: EdgeOptions): Design;
  build(): Graph;
}

export const COL_PX = 240;
export const ROW_PX = 140;

export const nodeId = (key: string) => `node_${key}`;
export const groupId = (key: string) => `grp_${key}`;
export const edgeId = (from: string, to: string) => `edge_${from}-${to}`;

/** Fluent graph builder; `build()` returns a fresh plain-data copy. */
export function design(): Design {
  const nodes: NodeInstance[] = [];
  const edges: EdgeInstance[] = [];
  const groups: Group[] = [];
  const api: Design = {
    group(key, kind, label, opts = {}) {
      groups.push({
        id: groupId(key),
        kind,
        label,
        ...(opts.regionId !== undefined ? { regionId: opts.regionId } : {}),
        ...(opts.parent !== undefined ? { parentId: groupId(opts.parent) } : {}),
        ...(opts.zone !== undefined
          ? { security: { public: opts.zone === 'public', firewallRules: [], zone: opts.zone } }
          : {}),
      });
      return api;
    },
    node(key, defId, label, [col, row], opts) {
      nodes.push({
        id: nodeId(key),
        defId,
        label,
        position: { x: col * COL_PX, y: row * ROW_PX },
        ...(opts.group !== undefined ? { groupId: groupId(opts.group) } : {}),
        config: { ...(opts.config ?? {}) },
        scaling: {
          replicas: opts.replicas ?? 1,
          instanceType: opts.type,
          ...(opts.autoscale !== undefined ? { autoscale: { ...opts.autoscale } } : {}),
        },
      });
      return api;
    },
    edge(from, to, stack, opts = {}) {
      edges.push({
        id: edgeId(from, to),
        source: nodeId(from),
        target: nodeId(to),
        protocolStack: [...stack],
        sync: !opts.async,
        config: { ...(opts.config ?? {}) },
      });
      return api;
    },
    build: () => structuredClone({ nodes, edges, groups }),
  };
  return api;
}

export type StepSpec = string | { key: string; op?: 'read' | 'write'; cacheable?: boolean };

export interface FlowSpec {
  key: string;
  name: string;
  share: number;
  rpsPerUser: number;
  /** Node keys in visiting order; `op` defaults to the flow's op. */
  op: 'read' | 'write';
  path: readonly StepSpec[];
}

export interface ScenarioSpec {
  usersByRegion: Record<string, number>;
  flows: readonly FlowSpec[];
  peakMultiplier?: number;
  diurnal?: boolean;
  payloadBytes?: { req: number; res: number };
  seed?: number;
  durationSec?: number;
}

/** A scenario preset whose flows follow the reference design's node keys. */
export function scenario(spec: ScenarioSpec): Scenario {
  const flows: Flow[] = spec.flows.map((f) => ({
    id: `flow_${f.key}`,
    name: f.name,
    share: f.share,
    rpsPerUser: f.rpsPerUser,
    path: f.path.map((s) => {
      const step = typeof s === 'string' ? { key: s } : s;
      return {
        nodeId: nodeId(step.key),
        op: step.op ?? f.op,
        ...(step.cacheable !== undefined ? { cacheable: step.cacheable } : {}),
      };
    }),
  }));
  return {
    usersByRegion: { ...spec.usersByRegion },
    flows,
    peakMultiplier: spec.peakMultiplier ?? 2,
    diurnal: spec.diurnal ?? false,
    payloadBytes: spec.payloadBytes ?? { req: 1_000, res: 10_000 },
    events: [],
    seed: spec.seed ?? 1,
    durationSec: spec.durationSec ?? 60,
  };
}

/** `company:<name>` tag (problem browser "company style" filter). */
export const company = (name: string) => `company:${name}`;

export const GB = 1e9;
export const TB = 1e12;
export const PB = 1e15;

// ---------- debug variants (S18) ----------

/**
 * A broken copy of a reference design for Debug mode. `edit` mutates the copy; keep every node a
 * flow path visits (the variant is played with the problem's scenario).
 */
export function broken(reference: Graph, edit: (g: BrokenGraph) => void): Graph {
  const g = structuredClone(reference);
  edit(new BrokenGraph(g));
  return g;
}

/** Small helpers for editing a reference copy by node key. */
export class BrokenGraph {
  constructor(readonly graph: Graph) {}
  node(key: string): NodeInstance {
    const n = this.graph.nodes.find((x) => x.id === nodeId(key));
    if (!n) throw new Error(`broken(): no node "${key}"`);
    return n;
  }
  edge(from: string, to: string): EdgeInstance {
    const e = this.graph.edges.find((x) => x.id === edgeId(from, to));
    if (!e) throw new Error(`broken(): no edge "${from}" → "${to}"`);
    return e;
  }
}
