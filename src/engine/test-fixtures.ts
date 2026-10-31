/**
 * Test-only helpers: a tiny registry with round-number perf models (so expected values can be
 * computed by hand) and graph/scenario builders. Not used by the app.
 */
import { z } from 'zod';
import type { EdgeInstance, Flow, Graph, NodeInstance, Scenario } from '@/core';
import { createRegistry, defineComponent, type Registry } from '@/registry';

type Cat = Parameters<typeof defineComponent>[0]['category'];
type Sat = 'queue' | 'reject' | 'degrade';

function comp(
  id: string,
  category: Cat,
  read: number,
  write: number,
  c: number,
  opts: { behaviors?: string[]; saturation?: Sat } = {},
) {
  return defineComponent({
    id,
    name: id,
    category,
    tags: [],
    icon: 'box',
    ports: [
      { id: 'in', direction: 'in', protocols: ['http2'] },
      { id: 'out', direction: 'out', protocols: ['http2'] },
    ],
    configSchema: z.object({}),
    defaults: {},
    instanceTypes: [{ id: 'std', vCpu: 1, memGb: 1, netGbps: 1, costUsdPerHour: 0.1 }],
    perf: {
      serviceTimeMs: { read, write },
      maxConcurrencyPerInstance: c,
      scaleCurve: 'linear',
      saturationBehavior: opts.saturation ?? 'queue',
    },
    ...(opts.behaviors ? { behaviors: opts.behaviors } : {}),
    docs: { summary: `Test component ${id}`, howItWorks: '', tradeoffs: [], interviewTips: [] },
  });
}

/** Components: S in ms (read/write), c = servers per instance. */
export const testRegistry: Registry = createRegistry(
  [
    comp('client.test', 'clients', 1, 1, 6),
    comp('compute.mm1', 'compute', 10, 10, 1), // μ = 100 rps
    comp('compute.mm2', 'compute', 10, 10, 2),
    comp('compute.reject', 'compute', 10, 10, 1, { saturation: 'reject' }),
    comp('compute.app', 'compute', 2, 4, 1), // μ = 500 rps (reads)
    comp('network.lb', 'network', 1, 1, 1, { behaviors: ['loadBalancer'], saturation: 'reject' }),
    comp('cache.test', 'cache', 0.5, 0.5, 1, { behaviors: ['cache'] }), // μ = 2000 rps
    comp('database.test', 'database', 20, 40, 1), // μ = 50 rps (reads)
    comp('messaging.queue', 'messaging', 1, 1, 1, { behaviors: ['queue'] }),
  ].map((entry) => ({ kind: 'component' as const, entry, source: 'engine/test-fixtures.ts' })),
);

export function node(
  id: string,
  defId: string,
  replicas = 1,
  config: Record<string, unknown> = {},
  instanceType = 'std',
): NodeInstance {
  return {
    id: `node_${id}`,
    defId,
    label: id,
    position: { x: 0, y: 0 },
    config,
    scaling: { replicas, instanceType },
  };
}

export function edge(source: string, target: string, sync = true): EdgeInstance {
  return {
    id: `edge_${source}_${target}`,
    source: `node_${source}`,
    target: `node_${target}`,
    protocolStack: ['tcp', 'http2'],
    sync,
    config: {},
  };
}

export function graph(nodes: NodeInstance[], edges: EdgeInstance[]): Graph {
  return { nodes, edges, groups: [] };
}

export function scenario(
  users: number,
  flows: Flow[] = [],
  extra: Partial<Scenario> = {},
): Scenario {
  return {
    usersByRegion: { 'north-america': users },
    flows,
    peakMultiplier: 1,
    diurnal: false,
    payloadBytes: { req: 1000, res: 10_000 },
    events: [],
    seed: 1,
    durationSec: 60,
    ...extra,
  };
}

/** A flow visiting the given short node ids with one op. */
export function flow(
  id: string,
  ids: string[],
  op: 'read' | 'write' = 'read',
  rpsPerUser = 1,
  share = 1,
): Flow {
  return {
    id: `flow_${id}`,
    name: id,
    share,
    rpsPerUser,
    path: ids.map((n) => ({ nodeId: `node_${n}`, op })),
  };
}
