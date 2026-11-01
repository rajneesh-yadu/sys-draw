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
  opts: {
    behaviors?: string[];
    saturation?: Sat;
    curve?: 'linear' | 'sublinear' | 'single-writer';
    config?: z.ZodObject;
    defaults?: Record<string, unknown>;
    instanceTypes?: {
      id: string;
      vCpu: number;
      memGb: number;
      netGbps: number;
      costUsdPerHour: number;
    }[];
  } = {},
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
    configSchema: opts.config ?? z.object({}),
    defaults: opts.defaults ?? {},
    instanceTypes: opts.instanceTypes ?? [STD, BIG],
    perf: {
      serviceTimeMs: { read, write },
      maxConcurrencyPerInstance: c,
      scaleCurve: opts.curve ?? 'linear',
      saturationBehavior: opts.saturation ?? 'queue',
    },
    ...(opts.behaviors ? { behaviors: opts.behaviors } : {}),
    docs: { summary: `Test component ${id}`, howItWorks: '', tradeoffs: [], interviewTips: [] },
  });
}

/** Instance sizes: std is the baseline; big has 4× the vCPU at 4× the price. */
const STD = { id: 'std', vCpu: 1, memGb: 1, netGbps: 1, costUsdPerHour: 0.1 };
const BIG = { id: 'big', vCpu: 4, memGb: 4, netGbps: 1, costUsdPerHour: 0.4 };

/** Data-store config using the scaling roles (`.meta({ scaling })`). */
const storeConfig = z.object({
  readReplicas: z.number().int().min(0).meta({ scaling: 'readReplicas' }),
  shards: z.number().int().min(1).meta({ scaling: 'shards' }),
  keySkew: z.number().min(0).max(1).meta({ scaling: 'keySkew' }),
  storageGb: z.number().min(0).meta({ scaling: 'storageGb' }),
  standby: z.boolean().meta({ scaling: 'standby' }),
});
const storeDefaults = { readReplicas: 0, shards: 1, keySkew: 0, storageGb: 0, standby: false };

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
    // μ = 100 rps per instance; one primary per shard takes every write.
    comp('database.primary', 'database', 10, 10, 1, {
      curve: 'single-writer',
      config: storeConfig,
      defaults: storeDefaults,
    }),
    // μ = 100 rps per instance; shards split reads AND writes.
    comp('database.sharded', 'database', 10, 10, 1, {
      config: storeConfig,
      defaults: storeDefaults,
    }),
    comp('compute.sub', 'compute', 10, 10, 1, { curve: 'sublinear' }),
    // Pay-per-request ($0/h) and platform-scaled (serverless-like) components.
    comp('storage.managed', 'storage', 10, 10, 100, {
      instanceTypes: [{ id: 'managed', vCpu: 1, memGb: 1, netGbps: 1, costUsdPerHour: 0 }],
      config: z.object({ storageGb: z.number().meta({ scaling: 'storageGb' }) }),
      defaults: { storageGb: 1000 },
    }),
    comp('compute.fn', 'compute', 30, 30, 1, {
      saturation: 'reject',
      config: z.object({
        limit: z.number().int().meta({ scaling: 'maxInstances' }),
        warm: z.number().int().meta({ scaling: 'minInstances' }),
      }),
      defaults: { limit: 10, warm: 0 },
    }),
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
