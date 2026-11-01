/**
 * S19: graph helpers shared by the design-review rules (rules/*.ts). Pure functions over a
 * `RuleContext`; no engine imports (the registry may only depend on core), so anything the rules
 * need from a simulation is read from `ctx.result`.
 */
import type { ComponentDefinition, EdgeInstance, Graph, NodeInstance, NodeMetrics } from '@/core';
import type { RuleContext } from './schemas';
import { ancestorGroupIds } from './security-tools';

export type Lookup = RuleContext['components'];

export function defOf(ctx: Pick<RuleContext, 'components'>, n: NodeInstance | undefined) {
  return n ? ctx.components.get(n.defId) : undefined;
}

export function nodeMap(graph: Graph): Map<string, NodeInstance> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

export const incoming = (graph: Graph, id: string): EdgeInstance[] =>
  graph.edges.filter((e) => e.target === id);
export const outgoing = (graph: Graph, id: string): EdgeInstance[] =>
  graph.edges.filter((e) => e.source === id);

export const isClientDef = (d: ComponentDefinition | undefined) => d?.category === 'clients';
export const isComputeDef = (d: ComponentDefinition | undefined) => d?.category === 'compute';
export const isDatabaseDef = (d: ComponentDefinition | undefined) => d?.category === 'database';
export const isCacheDef = (d: ComponentDefinition | undefined) =>
  d?.category === 'cache' || (d?.behaviors ?? []).includes('cache');
export const isMessagingDef = (d: ComponentDefinition | undefined) => d?.category === 'messaging';

/** Spreads requests over targets: load balancers, proxies, meshes, DNS, WAF/DDoS front doors. */
export function isBalancerDef(d: ComponentDefinition | undefined): boolean {
  if (!d) return false;
  const b = d.behaviors ?? [];
  return (
    b.includes('loadBalancer') ||
    b.includes('dns') ||
    d.tags.includes('load-balancer') ||
    d.id === 'network.api-gateway'
  );
}

/** Provider-run services that are multi-zone by design (not a single point of failure). */
export function isManagedDef(d: ComponentDefinition | undefined): boolean {
  if (!d) return false;
  return (
    d.tags.includes('managed') ||
    d.tags.includes('serverless') ||
    d.tags.includes('global') ||
    (d.behaviors ?? []).includes('serverless')
  );
}

/** Instances a node can run (autoscaling max, else replicas). */
export const maxInstances = (n: NodeInstance) => n.scaling.autoscale?.max ?? n.scaling.replicas;
/** Instances a node always runs (autoscaling min, else replicas). */
export const minInstances = (n: NodeInstance) => n.scaling.autoscale?.min ?? n.scaling.replicas;

/** Ids of nodes reachable from any client node by following edges (the request path). */
export function requestPath(ctx: Pick<RuleContext, 'graph' | 'components'>): Set<string> {
  const { graph } = ctx;
  const seen = new Set<string>();
  const queue = graph.nodes.filter((n) => isClientDef(defOf(ctx, n))).map((n) => n.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of graph.edges) if (e.source === id) queue.push(e.target);
  }
  return seen;
}

/** The nearest enclosing group of `kind` (with a region id, for regions). */
export function enclosingGroup(graph: Graph, n: NodeInstance, kind: 'region' | 'az') {
  for (const id of ancestorGroupIds(graph, n.groupId)) {
    const g = graph.groups.find((x) => x.id === id);
    if (g?.kind === kind && (kind !== 'region' || g.regionId)) return g;
  }
  return undefined;
}

/** Cloud region id a node is placed in (undefined when it is in no Region group). */
export const regionOf = (graph: Graph, n: NodeInstance) =>
  enclosingGroup(graph, n, 'region')?.regionId;

/** Steady-state metrics of a node, when a result exists for it. */
export function metricsOf(ctx: Pick<RuleContext, 'result'>, id: string): NodeMetrics | undefined {
  return ctx.result?.perNode[id];
}

type Introspectable = {
  meta?: () => Record<string, unknown> | undefined;
  def?: { innerType?: unknown };
};

/** Config key tagged `.meta({ scaling: role })` on a component (looks through wrappers). */
export function fieldWithRole(
  d: ComponentDefinition | undefined,
  role: string,
): string | undefined {
  if (!d) return undefined;
  for (const [key, field] of Object.entries(d.configSchema.shape)) {
    let cur = field as Introspectable | undefined;
    for (let i = 0; cur && i < 8; i++) {
      if (cur.meta?.()?.scaling === role) return key;
      cur = cur.def?.innerType as Introspectable | undefined;
    }
  }
  return undefined;
}

export function numberAt(config: Readonly<Record<string, unknown>>, key: string | undefined) {
  if (key === undefined) return undefined;
  const v = config[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Edge label for messages: "API → Orders DB". */
export function edgeName(byId: Map<string, NodeInstance>, e: EdgeInstance): string {
  return `${byId.get(e.source)?.label ?? e.source} → ${byId.get(e.target)?.label ?? e.target}`;
}

/** Share of a node's flow steps that are writes (undefined when no flow names the node). */
export function writeShare(ctx: Pick<RuleContext, 'scenario'>, nodeId: string): number | undefined {
  let reads = 0;
  let writes = 0;
  for (const f of ctx.scenario?.flows ?? []) {
    for (const s of f.path) {
      if (s.nodeId !== nodeId) continue;
      if (s.op === 'write') writes += f.share;
      else reads += f.share;
    }
  }
  return reads + writes > 0 ? writes / (reads + writes) : undefined;
}

export const round = (v: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
